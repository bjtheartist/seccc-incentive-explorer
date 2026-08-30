import { resolve } from "node:path";
import {
  Node,
  SyntaxKind,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildRealProject,
  findPathToFile,
} from "@/lib/source-guard/client-bundle-import-graph";

const REPORT_ROOTS = [
  {
    label: "live report",
    path: resolve(process.cwd(), "app/report/page.tsx"),
  },
  {
    label: "saved report",
    path: resolve(process.cwd(), "components/report/ReportDisplay.tsx"),
  },
] as const;

const PDF_REPORT_PATH = resolve(process.cwd(), "lib/pdf-report.ts");
const ZONING_MAP_PATH = resolve(
  process.cwd(),
  "components/report/ReportZoningMap.tsx",
);
const ZONING_MAP_ISLAND_PATH = resolve(
  process.cwd(),
  "components/report/ReportZoningMapIsland.tsx",
);

function importDeclarationHasRuntimeEdge(
  declaration: ImportDeclaration,
): boolean {
  if (declaration.isTypeOnly()) return false;
  if (declaration.getDefaultImport() || declaration.getNamespaceImport()) {
    return true;
  }
  const namedImports = declaration.getNamedImports();
  return (
    namedImports.length === 0 ||
    namedImports.some((specifier) => !specifier.isTypeOnly())
  );
}

function exportDeclarationHasRuntimeEdge(
  declaration: ExportDeclaration,
): boolean {
  if (declaration.isTypeOnly()) return false;
  const namedExports = declaration.getNamedExports();
  return (
    namedExports.length === 0 ||
    namedExports.some((specifier) => !specifier.isTypeOnly())
  );
}

function directStaticLocalImports(sourceFile: SourceFile): SourceFile[] {
  const imports: SourceFile[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!importDeclarationHasRuntimeEdge(declaration)) continue;
    const resolved = declaration.getModuleSpecifierSourceFile();
    if (resolved && !resolved.getFilePath().includes("/node_modules/")) {
      imports.push(resolved);
    }
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (!exportDeclarationHasRuntimeEdge(declaration)) continue;
    const resolved = declaration.getModuleSpecifierSourceFile();
    if (resolved && !resolved.getFilePath().includes("/node_modules/")) {
      imports.push(resolved);
    }
  }

  return imports;
}

function findStaticPathToFile(
  root: SourceFile,
  targetPath: string,
): string[] | null {
  if (root.getFilePath() === targetPath) return [root.getFilePath()];

  const visited = new Set<string>([root.getFilePath()]);
  const queue: Array<{ file: SourceFile; chain: string[] }> = [
    { file: root, chain: [root.getFilePath()] },
  ];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    for (const next of directStaticLocalImports(file)) {
      const path = next.getFilePath();
      if (path === targetPath) return [...chain, path];
      if (visited.has(path)) continue;
      visited.add(path);
      queue.push({ file: next, chain: [...chain, path] });
    }
  }

  return null;
}

function hasLiteralDynamicImport(
  sourceFile: SourceFile,
  moduleSpecifier: string,
): boolean {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
        return false;
      }
      const argument = call.getArguments()[0];
      return (
        argument != null &&
        Node.isStringLiteral(argument) &&
        argument.getLiteralText() === moduleSpecifier
      );
    });
}

describe("report heavy client boundaries", () => {
  const project = buildRealProject();
  const pdfReport = project.getSourceFileOrThrow(PDF_REPORT_PATH);
  const zoningMap = project.getSourceFileOrThrow(ZONING_MAP_PATH);
  const zoningMapIsland = project.getSourceFileOrThrow(
    ZONING_MAP_ISLAND_PATH,
  );

  it.each(REPORT_ROOTS)(
    "$label keeps PDF generation out of its initial static graph",
    ({ path }) => {
      const root = project.getSourceFileOrThrow(path);

      expect(findStaticPathToFile(root, pdfReport.getFilePath())).toBeNull();
      expect(findPathToFile(root, pdfReport.getFilePath())).not.toBeNull();
      expect(hasLiteralDynamicImport(root, "@/lib/pdf-report")).toBe(true);
      expect(root.getFullText()).toContain("generateReportPdf(report)");
    },
  );

  it.each(REPORT_ROOTS)(
    "$label reaches the zoning shell without statically reaching Mapbox",
    ({ path }) => {
      const root = project.getSourceFileOrThrow(path);

      expect(
        findStaticPathToFile(root, zoningMapIsland.getFilePath()),
      ).not.toBeNull();
      expect(findStaticPathToFile(root, zoningMap.getFilePath())).toBeNull();
      expect(findPathToFile(root, zoningMap.getFilePath())).not.toBeNull();
    },
  );

  it("loads the real zoning map lazily behind a fixed-height, default-SSR shell", () => {
    expect(
      hasLiteralDynamicImport(
        zoningMapIsland,
        "@/components/report/ReportZoningMap",
      ),
    ).toBe(true);
    expect(zoningMapIsland.getFullText()).toContain("min-h-[420px]");
    expect(zoningMapIsland.getFullText()).not.toMatch(/ssr\s*:\s*false/);
  });
});
