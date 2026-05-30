import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const navy = "#0C1B33";
const blue = "#2563EB";
const warm = "#FAF9F6";
const ice = "#EFF3FB";
const muted = "#5A6478";
const line = "#D8DDE6";
const green = "#16A34A";
const orange = "#F59E0B";
const red = "#EF4444";
const purple = "#7C3AED";

const statCards = [
  { value: "24", label: "Curated Incentive Programs" },
  { value: "20", label: "Zone Data Layers" },
  { value: "69", label: "Industry Categories" },
];

const zoneRows = [
  { label: "TIF District", value: 81, color: blue },
  { label: "Special Service Area", value: 87, color: green },
  { label: "Opportunity Zone", value: 49, color: purple },
  { label: "Enterprise Zone", value: 46, color: "#40916C" },
  { label: "High Unemployment", value: 25, color: orange },
];

const goalCards = [
  "Improve storefront",
  "Buy equipment",
  "Hire staff",
  "Acquire vacant property",
];

const workspaceTasks = [
  "Review eligible programs",
  "Call chamber or NBDC",
  "Gather project budget",
  "Confirm application timeline",
];

const page: CSSProperties = {
  background: warm,
  color: navy,
  fontFamily: "Inter, Arial, sans-serif",
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: "0.22em",
  textTransform: "uppercase",
};

const serif: CSSProperties = {
  fontFamily: '"Playfair Display", Georgia, serif',
  fontWeight: 500,
};

const full: CSSProperties = {
  width: "100%",
  height: "100%",
};

const gridBg: CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(12,27,51,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(12,27,51,0.055) 1px, transparent 1px)",
  backgroundSize: "80px 80px",
};

const softShadow = "0 26px 80px rgba(12, 27, 51, 0.14)";

const useIntro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });

  return {
    opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(y, [0, 1], [34, 0])}px)`,
  };
};

const fadeOut = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const slide = (frame: number, start: number, end: number, from = 36) =>
  interpolate(frame, [start, end], [from, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

const reveal = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

const Brand = ({ light = false }: { light?: boolean }) => (
  <div
    style={{
      position: "absolute",
      top: 54,
      left: 72,
      display: "flex",
      alignItems: "center",
      gap: 16,
      zIndex: 10,
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        border: `2px solid ${light ? "rgba(255,255,255,0.72)" : blue}`,
        display: "grid",
        placeItems: "center",
        color: light ? "#fff" : navy,
        fontWeight: 700,
      }}
    >
      C
    </div>
    <div>
      <div
        style={{
          ...mono,
          color: light ? "rgba(255,255,255,0.7)" : "rgba(12,27,51,0.48)",
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        Chicago
      </div>
      <div
        style={{
          color: light ? "#fff" : navy,
          fontSize: 23,
          fontWeight: 700,
          lineHeight: 1.05,
        }}
      >
        Incentive Explorer
      </div>
    </div>
  </div>
);

const Eyebrow = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div
    style={{
      ...mono,
      color: light ? "rgba(255,255,255,0.58)" : "rgba(37,99,235,0.72)",
      fontSize: 15,
      marginBottom: 24,
    }}
  >
    {children}
  </div>
);

const HeaderBlock = ({
  eyebrow,
  title,
  body,
  light = false,
  width = 760,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  light?: boolean;
  width?: number;
}) => {
  const intro = useIntro();

  return (
    <div style={{ ...intro, width }}>
      <Eyebrow light={light}>{eyebrow}</Eyebrow>
      <div
        style={{
          ...serif,
          color: light ? "#fff" : navy,
          fontSize: 86,
          lineHeight: 0.96,
          marginBottom: 28,
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: light ? "rgba(255,255,255,0.66)" : "rgba(12,27,51,0.58)",
          fontSize: 28,
          lineHeight: 1.35,
          maxWidth: width - 40,
        }}
      >
        {body}
      </div>
    </div>
  );
};

const Pill = ({
  children,
  color = blue,
  tint = "#EFF3FB",
}: {
  children: ReactNode;
  color?: string;
  tint?: string;
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 15px",
      background: tint,
      border: `1px solid ${color}30`,
      color,
      fontSize: 18,
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ width: 8, height: 8, background: color, display: "block" }} />
    {children}
  </div>
);

const HeroScene = () => {
  const frame = useCurrentFrame();
  const imageScale = interpolate(frame, [0, 210], [1.08, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fade = fadeOut(frame, 184, 210);

  return (
    <AbsoluteFill style={{ background: navy, opacity: fade }}>
      <Img
        src={staticFile("chicago-map-hero.png")}
        style={{
          ...full,
          objectFit: "cover",
          transform: `scale(${imageScale})`,
          opacity: 0.72,
        }}
      />
      <div
        style={{
          ...full,
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(12,27,51,0.14), rgba(12,27,51,0.88)), linear-gradient(90deg, rgba(12,27,51,0.92), rgba(12,27,51,0.18))",
        }}
      />
      <Brand light />
      <div style={{ position: "absolute", left: 130, bottom: 118 }}>
        <HeaderBlock
          light
          width={860}
          eyebrow="Product demo"
          title={
            <>
              Turn an address
              <br />
              into next steps.
            </>
          }
          body="A free map and reporting tool for Chicago businesses, corridor managers, developers, lenders, and support partners."
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 120,
          bottom: 132,
          width: 470,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(255,255,255,0.28)",
          boxShadow: "0 30px 100px rgba(0,0,0,0.32)",
          padding: 32,
        }}
      >
        <div style={{ ...mono, color: "rgba(12,27,51,0.36)", fontSize: 13 }}>
          Try an address
        </div>
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, padding: "18px 20px", border: `1px solid ${line}`, color: muted, fontSize: 20 }}>
            1535 W Roosevelt Rd
          </div>
          <div style={{ padding: "18px 22px", background: navy, color: "white", fontWeight: 700, fontSize: 18 }}>
            Search
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProblemScene = () => {
  const frame = useCurrentFrame();
  const fade = fadeOut(frame, 186, 210);

  return (
    <AbsoluteFill style={{ ...page, ...gridBg, opacity: fade }}>
      <Brand />
      <div style={{ position: "absolute", left: 120, top: 245 }}>
        <HeaderBlock
          eyebrow="The daily problem"
          title={
            <>
              Separate programs.
              <br />
              Different rules.
            </>
          }
          body="The opportunity is real, but the starting point is scattered across agencies, program pages, geography, and eligibility rules."
        />
      </div>
      <div style={{ position: "absolute", right: 118, top: 210, width: 700 }}>
        {[
          ["City / DPD", "Neighborhood grants, corridor programs, TIF support"],
          ["State + Federal", "Credits, census tracts, enterprise and opportunity zones"],
          ["County + Partners", "Land bank, financing, technical assistance"],
          ["Local Support", "Chambers, NBDCs, SBDCs, lenders, corridor managers"],
        ].map(([source, detail], index) => {
          const opacity = reveal(frame, 16 + index * 12, 34 + index * 12);
          return (
            <div
              key={source}
              style={{
                opacity,
                transform: `translateY(${slide(frame, 10 + index * 12, 34 + index * 12, 40)}px)`,
                background: "rgba(255,255,255,0.82)",
                border: `1px solid ${line}`,
                padding: "28px 32px",
                marginBottom: 18,
                boxShadow: index === 1 ? softShadow : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: navy, fontSize: 28, fontWeight: 700 }}>{source}</div>
                <div style={{ ...mono, color: "rgba(12,27,51,0.32)", fontSize: 12 }}>Eligibility varies</div>
              </div>
              <div style={{ color: "rgba(12,27,51,0.54)", fontSize: 20, marginTop: 10 }}>{detail}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const MapMock = () => {
  const frame = useCurrentFrame();
  const drawProgress = reveal(frame, 110, 180);

  return (
    <div
      style={{
        position: "relative",
        width: 1040,
        height: 670,
        background: "#F4E2B2",
        border: `1px solid ${line}`,
        overflow: "hidden",
        boxShadow: softShadow,
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.45, ...gridBg }} />
      {[
        { x: 80, y: 0, w: 230, h: 400, c: "rgba(37,99,235,0.32)" },
        { x: 310, y: 0, w: 155, h: 500, c: "rgba(22,163,74,0.26)" },
        { x: 465, y: 0, w: 500, h: 670, c: "rgba(245,158,11,0.22)" },
        { x: 0, y: 420, w: 390, h: 250, c: "rgba(124,58,237,0.18)" },
      ].map((shape, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: shape.x,
            top: shape.y,
            width: shape.w,
            height: shape.h,
            background: shape.c,
            borderRight: "1px solid rgba(255,255,255,0.35)",
          }}
        />
      ))}
      {["W Roosevelt Rd", "W 13th St", "S Leavitt St", "S Wood St"].map((road, index) => (
        <div
          key={road}
          style={{
            position: "absolute",
            left: index < 2 ? 430 : 650 + index * 90,
            top: index < 2 ? 160 + index * 170 : 40,
            transform: index < 2 ? "none" : "rotate(90deg)",
            color: "rgba(12,27,51,0.22)",
            fontSize: 24,
          }}
        >
          {road}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 440,
          top: 160,
          width: 430,
          height: 250,
          border: `5px dashed ${blue}`,
          opacity: reveal(frame, 110, 150),
          transform: `scale(${0.8 + drawProgress * 0.2}) rotate(-9deg)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: interpolate(frame, [40, 96], [260, 620], { extrapolateRight: "clamp" }),
          top: interpolate(frame, [40, 96], [470, 292], { extrapolateRight: "clamp" }),
          width: 24,
          height: 24,
          background: blue,
          border: "5px solid white",
          borderRadius: 99,
          boxShadow: "0 12px 30px rgba(37,99,235,0.35)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 585,
          top: 235,
          width: 350,
          background: "white",
          border: `1px solid ${line}`,
          padding: 24,
          opacity: reveal(frame, 75, 100),
          boxShadow: "0 20px 55px rgba(12,27,51,0.18)",
        }}
      >
        <div style={{ ...mono, color: "#40916C", fontSize: 13 }}>Zoning District</div>
        <div style={{ color: navy, fontSize: 42, marginTop: 12, fontWeight: 700 }}>PMD 7</div>
        <div style={{ color: muted, fontSize: 20 }}>Planned Manufacturing District #7</div>
      </div>
    </div>
  );
};

const MapScene = () => {
  const frame = useCurrentFrame();
  const fade = fadeOut(frame, 244, 270);

  return (
    <AbsoluteFill style={{ ...page, opacity: fade }}>
      <Brand />
      <div style={{ position: "absolute", left: 88, top: 164, width: 440 }}>
        <Eyebrow>Explore by address or area</Eyebrow>
        <div style={{ ...serif, fontSize: 66, lineHeight: 1, marginBottom: 28 }}>
          See what applies here.
        </div>
        <div style={{ color: "rgba(12,27,51,0.58)", fontSize: 24, lineHeight: 1.36 }}>
          Click a site, inspect zoning, or draw a corridor area to summarize incentive layers and vacant-property opportunities.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 34 }}>
          <Pill>TIF</Pill>
          <Pill color={green} tint="#ECFDF3">
            SSA
          </Pill>
          <Pill color={purple} tint="#F5F0FF">
            OZ
          </Pill>
          <Pill color={red} tint="#FEF2F2">
            CCSA
          </Pill>
        </div>
      </div>
      <div style={{ position: "absolute", right: 72, top: 184 }}>
        <MapMock />
      </div>
      <div
        style={{
          position: "absolute",
          right: 120,
          bottom: 86,
          display: "flex",
          gap: 18,
          opacity: reveal(frame, 178, 210),
        }}
      >
        {statCards.map((stat) => (
          <div key={stat.label} style={{ width: 245, background: navy, color: "white", padding: "25px 28px" }}>
            <div style={{ ...serif, fontSize: 50, lineHeight: 1 }}>{stat.value}</div>
            <div style={{ ...mono, color: "rgba(255,255,255,0.54)", fontSize: 11, marginTop: 14, lineHeight: 1.45 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const WizardScene = () => {
  const frame = useCurrentFrame();
  const fade = fadeOut(frame, 244, 270);
  const progress = reveal(frame, 48, 160);

  return (
    <AbsoluteFill style={{ ...page, ...gridBg, opacity: fade }}>
      <Brand />
      <div style={{ position: "absolute", left: 118, top: 190 }}>
        <HeaderBlock
          eyebrow="Generate a report"
          title={
            <>
              Pick the goal.
              <br />
              Get a clearer path.
            </>
          }
          body="Business owners can generate an incentive report or vacancy analysis without creating an account."
          width={680}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 118,
          top: 150,
          width: 770,
          background: "white",
          border: `1px solid ${line}`,
          boxShadow: softShadow,
          padding: 40,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <div style={{ ...mono, color: "rgba(12,27,51,0.36)", fontSize: 12 }}>Step 2 of 4</div>
            <div style={{ color: navy, fontSize: 34, fontWeight: 700, marginTop: 8 }}>What are you trying to do?</div>
          </div>
          <div style={{ width: 160, height: 8, background: "#EEF1F6" }}>
            <div style={{ width: `${34 + progress * 48}%`, height: "100%", background: blue }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {goalCards.map((goal, index) => {
            const active = index === Math.min(3, Math.floor(interpolate(frame, [64, 150], [0, 3.99], { extrapolateRight: "clamp" })));
            return (
              <div
                key={goal}
                style={{
                  padding: 24,
                  border: `2px solid ${active ? blue : line}`,
                  background: active ? "#EFF3FB" : "white",
                  minHeight: 128,
                }}
              >
                <div style={{ color: active ? blue : navy, fontSize: 24, fontWeight: 800 }}>{goal}</div>
                <div style={{ color: muted, fontSize: 17, marginTop: 10, lineHeight: 1.28 }}>
                  Match the report to the business decision in front of you.
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 28,
            padding: "22px 26px",
            background: navy,
            color: "white",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...mono, fontSize: 12, color: "rgba(255,255,255,0.58)" }}>Ready when you are</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Generate Vacancy Report</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ReportScene = () => {
  const frame = useCurrentFrame();
  const fade = fadeOut(frame, 244, 270);

  return (
    <AbsoluteFill style={{ background: ice, color: navy, opacity: fade }}>
      <Brand />
      <div style={{ position: "absolute", left: 118, top: 158, width: 720 }}>
        <Eyebrow>Report snapshot</Eyebrow>
        <div style={{ ...serif, fontSize: 76, lineHeight: 0.98, marginBottom: 28 }}>
          From eligibility
          <br />
          to a useful conversation.
        </div>
        <div style={{ color: "rgba(12,27,51,0.58)", fontSize: 25, lineHeight: 1.36 }}>
          Reports summarize zone fit, relevant programs, vacancy context, citations, and suggested next steps.
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 34 }}>
          <Pill color={blue}>Save Report</Pill>
          <Pill color={green} tint="#ECFDF3">
            Email This to Me
          </Pill>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 132,
          width: 760,
          height: 780,
          background: "white",
          border: `1px solid ${line}`,
          boxShadow: softShadow,
          padding: 42,
        }}
      >
        <div style={{ ...mono, color: "rgba(12,27,51,0.34)", fontSize: 13 }}>Chicago Site Incentive Report</div>
        <div style={{ color: navy, fontSize: 44, lineHeight: 1.08, fontWeight: 800, marginTop: 14 }}>
          1535 W Roosevelt Rd
        </div>
        <div style={{ color: muted, fontSize: 20, marginTop: 10 }}>Near West Side / Drawn-area analysis</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 34 }}>
          {[
            ["7", "Zones detected"],
            ["High", "Program fit"],
            ["4", "Next steps"],
          ].map(([value, label]) => (
            <div key={label} style={{ border: `1px solid ${line}`, padding: 20 }}>
              <div style={{ ...serif, fontSize: 46, lineHeight: 1 }}>{value}</div>
              <div style={{ ...mono, color: "rgba(12,27,51,0.36)", fontSize: 10, marginTop: 10 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 34 }}>
          {zoneRows.map((row, index) => {
            const width = interpolate(frame, [54 + index * 6, 110 + index * 6], [0, row.value], {
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div key={row.label} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ color: navy, fontSize: 18, fontWeight: 700 }}>{row.label}</div>
                  <div style={{ ...mono, color: "rgba(12,27,51,0.44)", fontSize: 11 }}>{row.value}%</div>
                </div>
                <div style={{ height: 10, background: "#EEF1F6" }}>
                  <div style={{ height: "100%", width: `${width}%`, background: row.color }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 36, padding: 26, borderLeft: `5px solid ${blue}`, background: "#F8FAFF" }}>
          <div style={{ color: navy, fontSize: 24, fontWeight: 800 }}>Recommended starting point</div>
          <div style={{ color: muted, fontSize: 18, lineHeight: 1.36, marginTop: 10 }}>
            Bring this report to a chamber, NBDC, SBDC, lender, or business support partner and ask which support can move your project forward.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const WorkspaceScene = () => {
  const frame = useCurrentFrame();
  const fade = fadeOut(frame, 212, 240);

  return (
    <AbsoluteFill style={{ ...page, opacity: fade }}>
      <Brand />
      <div style={{ position: "absolute", left: 118, top: 172 }}>
        <HeaderBlock
          eyebrow="Optional workspace"
          title={
            <>
              Save the report.
              <br />
              Keep moving.
            </>
          }
          body="When a user signs in, the tool becomes a lightweight project workspace for goals, checklists, saved reports, and follow-through."
          width={720}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 116,
          top: 132,
          width: 780,
          height: 790,
          background: navy,
          color: "white",
          padding: 40,
          boxShadow: softShadow,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ ...mono, color: "rgba(255,255,255,0.45)", fontSize: 12 }}>Workspace</div>
            <div style={{ fontSize: 38, fontWeight: 800, marginTop: 8 }}>Acquire vacant property</div>
          </div>
          <div style={{ padding: "13px 16px", background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.78)" }}>
            Google sign-in
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 34 }}>
          {[
            ["2", "Saved reports"],
            ["1", "Active project"],
          ].map(([value, label]) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.08)", padding: 28, border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ ...serif, fontSize: 56, lineHeight: 1 }}>{value}</div>
              <div style={{ ...mono, color: "rgba(255,255,255,0.46)", fontSize: 11, marginTop: 12 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 36 }}>
          <div style={{ ...mono, color: "rgba(255,255,255,0.48)", fontSize: 12, marginBottom: 18 }}>
            Next-step checklist
          </div>
          {workspaceTasks.map((task, index) => {
            const checked = frame > 54 + index * 24;
            return (
              <div
                key={task}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: "18px 0",
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  opacity: reveal(frame, 28 + index * 16, 48 + index * 16),
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    border: `2px solid ${checked ? green : "rgba(255,255,255,0.36)"}`,
                    background: checked ? green : "transparent",
                    display: "grid",
                    placeItems: "center",
                    color: "white",
                    fontWeight: 900,
                  }}
                >
                  {checked ? "✓" : ""}
                </div>
                <div style={{ color: "rgba(255,255,255,0.86)", fontSize: 24 }}>{task}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 40, right: 40, bottom: 40, display: "flex", gap: 16 }}>
          <div style={{ flex: 1, padding: 20, background: "white", color: navy, textAlign: "center", fontWeight: 800, fontSize: 20 }}>
            Open Report
          </div>
          <div style={{ flex: 1, padding: 20, border: "1px solid rgba(255,255,255,0.24)", color: "white", textAlign: "center", fontWeight: 800, fontSize: 20 }}>
            Download PDF
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CtaScene = () => {
  const frame = useCurrentFrame();
  const intro = reveal(frame, 0, 34);

  return (
    <AbsoluteFill style={{ background: navy, color: "white" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.12, ...gridBg }} />
      <Brand light />
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 250,
          width: 1100,
          opacity: intro,
          transform: `translateY(${slide(frame, 0, 34)}px)`,
        }}
      >
        <Eyebrow light>The tool starts the conversation</Eyebrow>
        <div style={{ ...serif, fontSize: 104, lineHeight: 0.96 }}>
          Scan. Search.
          <br />
          Save your next step.
        </div>
        <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 30, lineHeight: 1.35, width: 880, marginTop: 32 }}>
          Use Chicago Incentive Explorer to identify possible incentives, generate a report, and walk into the right support conversation prepared.
        </div>
        <div style={{ marginTop: 42, fontSize: 32, fontWeight: 800 }}>chicagoincentiveexplorer.com</div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 150,
          top: 282,
          width: 330,
          height: 330,
          background: "white",
          padding: 24,
          display: "grid",
          placeItems: "center",
          opacity: intro,
        }}
      >
        <Img
          src={staticFile("chicago-incentive-explorer-qr.png")}
          style={{ width: 282, height: 282, objectFit: "contain" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 150,
          top: 650,
          width: 330,
          textAlign: "center",
          color: "rgba(255,255,255,0.58)",
          fontSize: 18,
          lineHeight: 1.35,
        }}
      >
        Scan to try the live platform.
      </div>
    </AbsoluteFill>
  );
};

export const ProductDemo = () => {
  return (
    <AbsoluteFill style={page}>
      <Sequence from={0} durationInFrames={210}>
        <HeroScene />
      </Sequence>
      <Sequence from={210} durationInFrames={210}>
        <ProblemScene />
      </Sequence>
      <Sequence from={420} durationInFrames={270}>
        <MapScene />
      </Sequence>
      <Sequence from={690} durationInFrames={270}>
        <WizardScene />
      </Sequence>
      <Sequence from={960} durationInFrames={270}>
        <ReportScene />
      </Sequence>
      <Sequence from={1230} durationInFrames={240}>
        <WorkspaceScene />
      </Sequence>
      <Sequence from={1470} durationInFrames={150}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
};
