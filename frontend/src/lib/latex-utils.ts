/**
 * latex-utils.ts
 */

export type CompileStatus =
    | "idle"
    | "unsaved"
    | "compiling"
    | "success"
    | "error";

export interface EditorError {
    line: number | null;
    message: string;
    context: string | null;
    source_fragment: string | null;
    suggested_fix: string | null;
    section_id: string | null;
}

// ── Debounce ──────────────────────────────────────────────────────────────────

export function debounce<A extends any[], R>(
    fn: (...args: A) => R,
    delay: number
): (...args: A) => void {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: A) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ── Lint ──────────────────────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS = [
    /lorem ipsum/i,
    /\[answer for:/i,
    /content goes here/i,
    /placeholder/i,
    /todo:/i,
    /fixme:/i,
    /\[figure here\]/i,
    /\[table here\]/i,
    /\[citation needed\]/i,
    /textit\{detailed content for/i,
];

const REQUIRED_COMMANDS = [
    "\\documentclass",
    "\\begin{document}",
    "\\end{document}",
];

export interface LintResult {
    hasPlaceholders: boolean;
    missingCommands: string[];
    unclosedEnvironments: string[];
    warnings: string[];
}

export function lintLatex(source: string | undefined | null): LintResult {
    if (!source || typeof source !== "string") {
        return { hasPlaceholders: false, missingCommands: [], unclosedEnvironments: [], warnings: [] };
    }
    const warnings: string[] = [];
    const hasPlaceholders = PLACEHOLDER_PATTERNS.some((p) => p.test(source));
    if (hasPlaceholders) warnings.push("Document contains placeholder text — run Polish to clean up.");
    const missingCommands = REQUIRED_COMMANDS.filter((cmd) => !source.includes(cmd));
    const openMatches = (source.match(/\\begin\{(\w+)\}/g) ?? []).map((m) => m.replace(/\\begin\{|\}/g, ""));
    const closeMatches = new Set((source.match(/\\end\{(\w+)\}/g) ?? []).map((m) => m.replace(/\\end\{|\}/g, "")));
    const unclosedEnvironments = openMatches.filter((env) => !closeMatches.has(env));
    return { hasPlaceholders, missingCommands, unclosedEnvironments, warnings };
}

// ── Line / error helpers ──────────────────────────────────────────────────────

export function findErrorLine(source: string, fragment: string | null): number | null {
    if (!fragment || !source) return null;
    const lines = source.split("\n");
    const needle = fragment.trim().slice(0, 60);
    const idx = lines.findIndex((l) => l.includes(needle));
    return idx >= 0 ? idx + 1 : null;
}

export function statusLabel(status: CompileStatus): string {
    switch (status) {
        case "idle": return "Ready";
        case "unsaved": return "Unsaved changes";
        case "compiling": return "Compiling…";
        case "success": return "Compiled successfully";
        case "error": return "Compilation errors";
    }
}

export function statusColor(status: CompileStatus): string {
    switch (status) {
        case "idle": return "text-muted-foreground";
        case "unsaved": return "text-yellow-500";
        case "compiling": return "text-blue-500";
        case "success": return "text-green-500";
        case "error": return "text-red-500";
    }
}

// ── autoFixLatex ─────────────────────────────────────────────────────────────
//
// Fixes the most common AI LaTeX generation errors before sending to compiler.
// Strategy: work on the full source string with targeted regex passes,
// rather than a fragile line-by-line env tracker.

/**
 * Sanitise a label/ref/cite argument so it contains only safe chars.
 * LaTeX \endcsname errors are caused by _ ^ & $ # % { } ~ in label names.
 */
function sanitiseLabelArg(arg: string): string {
    return arg
        .replace(/_/g, "-")   // underscore → hyphen
        .replace(/\^/g, "-")
        .replace(/&/g, "-")
        .replace(/\$/g, "")
        .replace(/#/g, "")
        .replace(/%/g, "")
        .replace(/~/g, "-")
        .replace(/[{}]/g, "")
        .replace(/\s+/g, "-") // spaces → hyphen
        .replace(/-{2,}/g, "-"); // collapse multiple hyphens
}

export function autoFixLatex(source: string): string {
    if (!source) return source;

    // ── Pass 1: Fix \label, \ref, \pageref, \autoref, \nameref args ───────────
    // These cause \endcsname errors when they contain _ ^ & etc.
    source = source.replace(
        /\\(label|ref|pageref|autoref|nameref|eqref)\{([^}]+)\}/g,
        (match, cmd, arg) => {
            const fixed = sanitiseLabelArg(arg);
            return fixed === arg ? match : `\\${cmd}{${fixed}}`;
        }
    );

    // ── Pass 2: Fix \hyperref[label]{text} — label part only ─────────────────
    source = source.replace(
        /\\hyperref\[([^\]]+)\]/g,
        (match, label) => {
            const fixed = sanitiseLabelArg(label);
            return fixed === label ? match : `\\hyperref[${fixed}]`;
        }
    );

    // ── Pass 3: Fix \includegraphics with placeholder/nonexistent filenames ────
    // Replace the entire \includegraphics line with a compilable fbox placeholder
    source = source.replace(
        /\\includegraphics(?:\[[^\]]*\])?\{[^}]*\}/g,
        (match) => {
            const knownBad = /placeholder|example-image|sample|dummy|todo|\.png|\.jpg|\.pdf|\.eps/i.test(match);
            if (!knownBad) return match; // keep if it looks intentional
            return "\\fbox{\\parbox{0.6\\linewidth}{\\centering Figure placeholder}}";
        }
    );

    // ── Pass 4: Remove \graphicspath (always causes issues without real images) -
    source = source.replace(/\\graphicspath\{[^}]*\}/g, "");

    // ── Pass 5: Wrap lonely \item in itemize ─────────────────────────────────
    // Find \item lines that appear outside any list environment.
    // Simple heuristic: if \item appears directly after a \section/\chapter/
    // blank line without a preceding \begin{itemize/enumerate}, wrap it.
    source = source.replace(
        /((?:^|\n)(?![ \t]*\\(?:begin|end)\{(?:itemize|enumerate|description)\})[^\n]*\n)((?:[ \t]*\\item[^\n]*\n)+)/g,
        (match, before, items) => {
            // Check if we're already inside a list by scanning backwards for \begin{itemize}
            // This regex approach: only wrap if the block before doesn't end with \begin{list-env}
            if (/\\begin\{(?:itemize|enumerate|description)\}\s*$/.test(before)) {
                return match; // already inside list
            }
            return `${before}\\begin{itemize}\n${items}\\end{itemize}\n`;
        }
    );

    // ── Pass 6: Remove \hline outside tabular ────────────────────────────────
    // Remove \hline that appears between \end{...} and \begin{...} (i.e. outside table)
    source = source.replace(/\\end\{(?:tabular[x*]?|longtable)\}([\s\S]*?)\\begin\{(?:tabular[x*]?|longtable)\}/g,
        (match) => match.replace(/^\s*\\hline\s*$/gm, "")
    );
    // Also remove standalone \hline lines that are clearly outside tables
    // (surrounded by normal text paragraphs, not & column separators)
    source = source.replace(/^([ \t]*\\hline[ \t]*)$/gm, (line, _, offset) => {
        // Check if there's a & nearby (within 5 lines) — if not, it's outside tabular
        const ctx = source.slice(Math.max(0, offset - 200), offset + 200);
        return ctx.includes("&") ? line : "";
    });

    // ── Pass 7: Remove \usepackage{setspace} and spacing commands ────────────
    source = source.replace(/\\usepackage(?:\[[^\]]*\])?\{setspace\}\n?/g, "");
    source = source.replace(/\\(onehalfspacing|doublespacing|singlespacing)\n?/g, "");

    // ── Pass 8: Collapse 3+ blank lines → 2 ──────────────────────────────────
    source = source.replace(/\n{3,}/g, "\n\n");

    return source;
}