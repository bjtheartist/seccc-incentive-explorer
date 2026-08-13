#!/usr/bin/env python3
"""Shared filing-identity resolution for the foundation grant universe.

Used by build_grant_identity.py (stable per-row identity, deliverable 2) and
adjudicate_dedupe.py (236-group adjudication, deliverable 3). Both need the
same (funder, tax_year) -> filing object id resolution and the same cached
XML fetch/parse, so it lives here once rather than drifting across two
scripts.

Tier1/Phase2/Phase3 rows resolve straight from their committed reconciliation
reports (already carry object_id/tax_period/amended per filing). Base-file
rows predate that discipline, so their object ids are resolved live from
ProPublica (EIN -> object ids) + the gt990datalake S3 XML (never
ProPublica's own download-xml endpoint, which is bot-blocked).
"""
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phase2_pipeline as pp  # noqa: E402  fetch/parse helpers + XML cache discipline

INPUTS = pp.INPUTS

FOUNDATION_FILES = {
    "base": "foundation_grants_geocoded.csv",
    "tier1": "foundation_grants_tier1_expansion.csv",
    "phase2": "foundation_grants_phase2_expansion.csv",
    "phase3": "foundation_grants_phase3_expansion.csv",
}
RECON_FILES = {
    "tier1": "foundation_grants_tier1_reconciliation_report.csv",
    "phase2": "foundation_grants_phase2_reconciliation_report.csv",
    "phase3": "foundation_grants_phase3_reconciliation_report.csv",
}


def norm_text(s):
    return re.sub(r"[^A-Z0-9]+", " ", (s or "").upper()).strip()


def load_foundation_rows():
    """{tag: [row dict with 'raw_idx', ...]} in committed CSV order."""
    out = {}
    for tag, fname in FOUNDATION_FILES.items():
        rows = []
        with open(os.path.join(INPUTS, fname), newline="") as f:
            for i, r in enumerate(csv.DictReader(f)):
                r["raw_idx"] = i
                rows.append(r)
        out[tag] = rows
    return out


def schedule_part_for(return_type):
    """The IRS filing part/schedule a grant row is extracted from, by return type."""
    rt = (return_type or "").upper()
    if "990PF" in rt or "990-PF" in rt:
        return "990-PF Part XV Line 3a (SupplementaryInformationGrp)"
    if rt == "990" or "990" in rt:
        return "990 Schedule I Part II (RecipientTable)"
    return "unknown"


def build_recon_index(tag):
    """(funder, tax_yr) -> filing dict {object_id, tax_period_begin, tax_period_end,
    amended, schedule_part, return_type}, one row per committed reconciliation report
    line (already the amended/superseding-resolved filing per Sol's Phase-2/3
    pipeline: the integrator's checkpoint carries exactly the filing that produced
    the published rows for that tax year -- see phase3_integrate.py `year_oid`)."""
    idx = {}
    fname = RECON_FILES.get(tag)
    if not fname:
        return idx
    path = os.path.join(INPUTS, fname)
    if not os.path.exists(path):
        return idx
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            key = (r["funder"], r["tax_yr"])
            # A funder can have MULTIPLE filings across different tax years, but a
            # given (funder, tax_yr) should resolve to exactly one filing in the
            # committed recon report. If two rows share the key (should not happen
            # post-integration), the later (higher object_id = more recently filed)
            # wins -- that IS the amended/superseding rule (Q1/F4).
            prev = idx.get(key)
            if prev is None or r["object_id"] > prev["object_id"]:
                idx[key] = {
                    "object_id": r["object_id"],
                    "tax_period_begin": r["tax_period_begin"],
                    "tax_period_end": r["tax_period_end"],
                    "amended": r["amended"],
                    "schedule_part": schedule_part_for(r["return_type"]),
                    "return_type": r["return_type"],
                }
    return idx


_base_ein_cache = None


def base_funder_eins():
    global _base_ein_cache
    if _base_ein_cache is not None:
        return _base_ein_cache
    out = {}
    path = os.path.join(INPUTS, "foundation_funder_census.csv")
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if r["disposition"] != "already_parsed":
                continue
            m = re.search(r"parsed as '([^']+)'", r["notes"] or "")
            if m:
                out[m.group(1)] = r["ein"].zfill(9)
    _base_ein_cache = out
    return out


_base_filing_cache = {}


def resolve_base_filings(ein):
    """All parsed filings for a base-file EIN: [{object_id, tax_yr, tax_period_begin,
    tax_period_end, amended, schedule_part, return_type}], amended/superseding
    resolved (same tax_yr, higher object_id wins -- see build_recon_index note)."""
    if ein in _base_filing_cache:
        return _base_filing_cache[ein]
    filings_by_year = {}
    try:
        oids = pp.resolve_object_ids(ein)
    except Exception as exc:  # noqa: BLE001
        print(f"WARN base EIN {ein}: resolve_object_ids failed: {exc}", file=sys.stderr)
        oids = []
    for oid in oids:
        try:
            ret = pp.parse_return(pp.fetch_xml(oid), oid)
        except Exception as exc:  # noqa: BLE001
            print(f"WARN base EIN {ein} oid {oid}: fetch/parse failed: {exc}", file=sys.stderr)
            continue
        if ret is None:
            continue
        yr = ret["tax_yr"]
        prev = filings_by_year.get(yr)
        if prev is None or oid > prev["object_id"]:
            filings_by_year[yr] = {
                "object_id": oid,
                "tax_yr": yr,
                "tax_period_begin": ret["tax_period_begin"],
                "tax_period_end": ret["tax_period_end"],
                "amended": ret["amended"],
                "schedule_part": schedule_part_for(ret["return_type"]),
                "return_type": ret["return_type"],
            }
    _base_filing_cache[ein] = filings_by_year
    return filings_by_year


_grants_cache = {}


def filing_grants(object_id):
    """Parsed grant list (raw dicts, XML document order) for a filing, cached."""
    if object_id in _grants_cache:
        return _grants_cache[object_id]
    try:
        ret = pp.parse_return(pp.fetch_xml(object_id), object_id)
        grants = ret["grants"] if ret else None
    except Exception as exc:  # noqa: BLE001
        print(f"WARN oid {object_id}: fetch/parse failed: {exc}", file=sys.stderr)
        grants = None
    _grants_cache[object_id] = grants
    return grants


def resolve_filing_for_row(tag, row, recon_indexes, base_eins):
    """-> filing dict or None. `recon_indexes` is {tag: (funder,tax_yr)->filing}."""
    if tag == "base":
        ein = base_eins.get((row.get("foundation") or "").strip())
        if not ein:
            return None
        filings = resolve_base_filings(ein)
        return filings.get((row.get("tax_year") or "").strip())
    idx = recon_indexes.get(tag, {})
    return idx.get(((row.get("foundation") or "").strip(), (row.get("tax_year") or "").strip()))
