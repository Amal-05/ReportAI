from uuid import UUID
import re
import json

from fastapi import APIRouter, Depends, status, Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.ai_utils import get_openai_client_and_model
from app.api.deps import get_current_user, get_owned_project
from app.db.session import get_db
from app.models.content import GeneratedContent
from app.models.questionnaire import Questionnaire
from app.models.template import Template
from app.models.user import User
from app.schemas.generation import GenerateContentRequest, GeneratedSectionRead, ResearchAssistRequest, ResearchAssistResponse
from app.services.ai_content import AIContentService

router = APIRouter()


# ── Request schemas ───────────────────────────────────────────────────────────

class ProjectInfo(BaseModel):
    title: str
    domain: str
    description: str


class QuestionInfo(BaseModel):
    id: str
    label: str
    type: str


class EnhanceAnswersRequest(BaseModel):
    project: ProjectInfo
    answers: dict[str, str]
    questions: list[QuestionInfo]


class TemplateProfileInfo(BaseModel):
    chapters: list[str] | None = None
    citation: str | None = None
    font: str | None = None
    spacing: str | None = None


class GenerateReportRequest(BaseModel):
    project: ProjectInfo
    answers: dict[str, str]
    questions: list[QuestionInfo]
    templateProfile: TemplateProfileInfo | None = None


class GenerateQuestionsRequest(BaseModel):
    project: ProjectInfo
    templateProfile: TemplateProfileInfo | None = None


class PolishLatexRequest(BaseModel):
    latex_source: str
    project: ProjectInfo


# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_CHAPTERS = [
    "Introduction",
    "System Study",
    "System Requirements",
    "System Design",
    "Implementation",
    "Testing",
    "Results",
    "Conclusion",
    "Future Scope",
]

VALID_CHAPTER_KEYWORDS = {
    "abstract", "introduction", "literature", "review", "study",
    "analysis", "design", "architecture", "methodology", "implementation",
    "testing", "results", "discussion", "conclusion", "future", "scope",
    "requirements", "srs", "system", "background", "overview",
    "related", "work", "evaluation", "performance",
}

CHAPTER_ANSWER_KEYS: dict[str, list[str]] = {
    "Abstract":             ["abstract", "overview"],
    "Introduction":         ["problem_statement", "objectives", "scope", "background", "motivation", "introduction"],
    "System Study":         ["existing_system", "proposed_system", "feasibility", "system_study",
                             "technical_feasibility", "economic_feasibility", "operational_feasibility"],
    "Literature Review":    ["literature_review", "related_work", "prior_work", "survey", "background"],
    "System Requirements":  ["functional_requirements", "non_functional_requirements", "requirements",
                             "hardware_requirements", "software_requirements", "system_requirements"],
    "System Analysis":      ["system_analysis", "dfd", "use_case"],
    "System Design":        ["system_design", "database_design", "architecture", "hardware_architecture",
                             "software_architecture", "tech_stack", "database", "uml", "er_diagram"],
    "Methodology":          ["methodology", "algorithm", "approach", "model_architecture",
                             "system_architecture", "implementation_tools", "dataset", "model"],
    "Implementation":       ["implementation", "hardware_protocol", "power_control",
                             "code_structure", "sensors", "controller", "protocol", "tools",
                             "technology", "tech_stack"],
    "Testing":              ["testing_methods", "test_cases", "test_results", "evaluation", "testing"],
    "Results":              ["results", "evaluation_metrics", "performance", "outcomes",
                             "comparison", "accuracy"],
    "Conclusion":           ["conclusion", "summary", "findings"],
    "Future Scope":         ["future_scope", "future_work", "enhancements", "limitations", "future"],
}

EXACT_ONLY_KEYS = {"scope", "model", "database", "summary", "survey", "tools", "background"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_nil_answer(value: str) -> bool:
    if not value:
        return True
    return value.strip().lower() in {
        "", "nil", "none", "nothing", "n/a", "na",
        "not applicable", "null", "no", "none.", "nil.",
    }


def _validate_chapters(chapters: list[str] | None) -> list[str] | None:
    if not chapters:
        return None
    valid_count = sum(
        1 for c in chapters
        if any(kw in c.lower() for kw in VALID_CHAPTER_KEYWORDS)
    )
    if valid_count / len(chapters) < 0.6:
        return None
    if any(len(c) > 40 for c in chapters):
        return None
    return chapters


def _collect_answers_for_chapter(chapter: str, answers: dict[str, str]) -> list[tuple[str, str]]:
    matched: set[str] = set()
    result: list[tuple[str, str]] = []
    target_keys = CHAPTER_ANSWER_KEYS.get(chapter, [chapter.lower().replace(" ", "_")])

    for target in target_keys:
        for ans_key, ans_val in answers.items():
            if ans_key in matched or is_nil_answer(ans_val):
                continue
            if ans_key == target:
                matched.add(ans_key)
                result.append((_fmt_key(ans_key), ans_val.strip()))
            elif ans_key not in EXACT_ONLY_KEYS and target not in EXACT_ONLY_KEYS:
                if target in ans_key or (len(ans_key) > 4 and ans_key in target):
                    matched.add(ans_key)
                    result.append((_fmt_key(ans_key), ans_val.strip()))
    return result


def _fmt_key(k: str) -> str:
    return k.replace("_", " ").title()


def _spacing(s: str | None) -> str:
    """Return a baselinestretch command — avoids the setspace package."""
    try:
        v = float(s or "1.5")
        if v >= 1.8: return r"\renewcommand{\baselinestretch}{2.0}"
        if v < 1.3:  return r"\renewcommand{\baselinestretch}{1.0}"
    except (ValueError, TypeError):
        pass
    return r"\renewcommand{\baselinestretch}{1.5}"


def _bib(c: str | None) -> str:
    if c and ("apa" in c.lower() or "harvard" in c.lower()):
        return "apalike"
    return "IEEEtran"


def _basic_clean(source: str) -> str:
    """
    Regex-based LaTeX cleanup.
    Fixes: placeholders, lonely \\item, \\hline outside tabular, excess blank lines.
    """
    # Remove placeholder italic blocks
    source = re.sub(
        r"\\textit\{Detailed content for the [^}]+ phase[^}]*\}",
        "", source, flags=re.IGNORECASE,
    )
    source = re.sub(r"\[Answer for:[^\]]*\]", "", source, flags=re.IGNORECASE)
    source = re.sub(r"lorem ipsum[^.]*\.", "", source, flags=re.IGNORECASE)

    # Fix lonely \\item — wrap consecutive \\item blocks in itemize
    lines = source.split("\n")
    out = []
    in_list = False
    list_depth = 0

    for line in lines:
        stripped = line.strip()

        # Track environment depth
        if re.match(r"\\begin\{(itemize|enumerate|description)\}", stripped):
            in_list = True
            list_depth += 1
            out.append(line)
            continue
        if re.match(r"\\end\{(itemize|enumerate|description)\}", stripped):
            list_depth = max(0, list_depth - 1)
            in_list = list_depth > 0
            out.append(line)
            continue

        # Lonely \\item
        if stripped.startswith("\\item") and not in_list:
            out.append("\\begin{itemize}")
            out.append(line)
            # peek ahead to collect all consecutive items
            in_list = True
            list_depth += 1
            continue

        # Close auto-opened list when we hit a non-item, non-blank line
        if in_list and list_depth > 0 and not stripped.startswith("\\item") and stripped and not stripped.startswith("%"):
            # Only close if the list was auto-opened (heuristic: close at chapter/section)
            if re.match(r"\\(chapter|section|subsection|end\{)", stripped):
                out.append("\\end{itemize}")
                list_depth = max(0, list_depth - 1)
                in_list = list_depth > 0

        out.append(line)

    # Close any still-open auto lists
    if in_list and list_depth > 0:
        out.append("\\end{itemize}")

    source = "\n".join(out)

    # Remove \\hline outside tabular (simple heuristic: remove standalone \\hline lines)
    # We don't track environments here so just remove lines that are ONLY \\hline
    # and appear between two non-table lines — conservative: only remove if surrounded by text
    source = re.sub(r"(?<!begin\{tabular[^}]*\})\n\\hline(?=\n[^&])", "", source)

    # Collapse triple+ blank lines
    source = re.sub(r"\n{3,}", "\n\n", source)
    source = "\n".join(line.rstrip() for line in source.splitlines())
    return source


def _extract_ai_text(response) -> str:
    """Robustly extract text content from an AI response (handles Gemini quirks)."""
    choice = response.choices[0]
    if choice.message.content:
        return choice.message.content
    try:
        return choice.message.model_extra.get("content", "") or ""
    except Exception:
        return ""


# ── Chapter intros ────────────────────────────────────────────────────────────

_INTROS: dict[str, str] = {
    "Abstract": (
        r"This report presents the design, development, and evaluation of "
        r"\textbf{TITLE}, a project in the domain of DOMAIN. "
        r"The work addresses a focused problem, proposes a systematic solution, "
        r"and validates outcomes through structured testing and analysis."
    ),
    "Introduction": (
        r"This chapter establishes the context and motivation for \textbf{TITLE}. "
        r"It outlines the identified problem, the scope of the work, key objectives, "
        r"and the structural organisation of this report."
    ),
    "System Study": (
        r"This chapter presents a detailed study of the existing system, identifies "
        r"its limitations, and describes the proposed system for \textbf{TITLE}. "
        r"A feasibility study is also included to evaluate the practicability of the solution."
    ),
    "Literature Review": (
        r"A systematic review of existing literature and prior research relevant to "
        r"\textbf{TITLE} was conducted to identify gaps and inform design decisions."
    ),
    "System Requirements": (
        r"This chapter documents the functional and non-functional requirements "
        r"for \textbf{TITLE}, including hardware and software specifications."
    ),
    "System Analysis": (
        r"This chapter presents the requirements analysis, data flow diagrams, "
        r"and use-case models developed for \textbf{TITLE}."
    ),
    "System Design": (
        r"The system design chapter details the architectural blueprint, "
        r"database schemas, and component interactions for \textbf{TITLE}."
    ),
    "Methodology": (
        r"This chapter describes the theoretical foundations, algorithms, "
        r"and experimental configurations adopted to develop \textbf{TITLE}."
    ),
    "Implementation": (
        r"The implementation chapter documents the development environment, "
        r"tools, technologies, and integration steps for \textbf{TITLE}."
    ),
    "Testing": (
        r"Validation and verification tests were systematically conducted to "
        r"confirm the correctness and reliability of \textbf{TITLE}. "
        r"This chapter covers unit testing, integration testing, and scenario-based verification."
    ),
    "Results": (
        r"This chapter presents the experimental outcomes, performance metrics, "
        r"and comparative evaluations obtained from testing \textbf{TITLE}."
    ),
    "Conclusion": (
        r"This chapter summarises the research contributions, outcomes achieved, "
        r"and lessons learned during the development of \textbf{TITLE}."
    ),
    "Future Scope": (
        r"This chapter outlines potential enhancements, scalability improvements, "
        r"and research directions that could extend \textbf{TITLE} in future work."
    ),
}

_GENERIC_INTRO = (
    r"This chapter presents the SECTION aspects of \textbf{TITLE}, covering "
    r"the key design decisions, implementation details, and evaluation criteria "
    r"relevant to this phase of the project."
)


def _intro(chapter: str, title: str, domain: str) -> str:
    tpl = _INTROS.get(chapter, _GENERIC_INTRO)
    return tpl.replace("TITLE", title).replace("DOMAIN", domain).replace("SECTION", chapter.lower())


# ── Fallback LaTeX (no AI key) ────────────────────────────────────────────────

def _build_fallback_latex(payload: "GenerateReportRequest") -> str:
    title = payload.project.title
    domain = payload.project.domain
    description = payload.project.description

    raw_chapters = payload.templateProfile.chapters if payload.templateProfile else None
    chapters = _validate_chapters(raw_chapters) or DEFAULT_CHAPTERS
    FRONT_MATTER = {"certificate", "declaration", "acknowledgement",
                    "table of contents", "contents", "list of figures", "list of tables"}
    body_chapters = [c for c in chapters if c.lower() not in FRONT_MATTER]

    spacing_cmd = _spacing(payload.templateProfile.spacing if payload.templateProfile else None)
    bib = _bib(payload.templateProfile.citation if payload.templateProfile else None)

    front = rf"""\chapter*{{Certificate}}
This is to certify that the project report titled \textbf{{{title}}} submitted by the
student(s) is a bonafide record of work carried out under our supervision in partial
fulfilment of the requirements for the award of the degree.

\vspace{{2cm}}
\noindent\textbf{{Project Guide}} \hfill \textbf{{Head of Department}}

\chapter*{{Declaration}}
I/We hereby declare that the project entitled \textbf{{{title}}} submitted for the
academic programme is our original work. Any references to other works have been duly cited.

\vspace{{1cm}}
\noindent\textbf{{Student Signature(s):}} \underline{{\hspace{{5cm}}}}

\chapter*{{Acknowledgement}}
The authors express sincere gratitude to their project supervisor, department faculty,
and fellow colleagues whose guidance was invaluable throughout the development of
\textbf{{{title}}}. Special thanks are extended to the institution for providing the
necessary resources and infrastructure."""

    body_parts: list[str] = []
    for chapter in body_chapters:
        tex = f"\\chapter{{{chapter}}}\n"
        tex += _intro(chapter, title, domain) + "\n\n"
        if chapter == "Introduction" and description:
            tex += description + "\n\n"
        answers = _collect_answers_for_chapter(chapter, payload.answers)
        if answers:
            for label, value in answers:
                tex += f"\\section{{{label}}}\n{value}\n\n"
        elif chapter not in ("Abstract",):
            tex += (
                f"\\textit{{Detailed content for the {chapter.lower()} phase "
                f"will be populated based on project-specific data and evidence.}}\n"
            )
        body_parts.append(tex)

    body = "\n\n".join(body_parts)

    return rf"""\documentclass[12pt,a4paper]{{report}}
\usepackage[margin=1in]{{geometry}}
\usepackage{{hyperref}}
\usepackage{{titlesec}}
\usepackage{{parskip}}
{spacing_cmd}
\hypersetup{{colorlinks=true, linkcolor=black, citecolor=black, urlcolor=blue}}

\title{{{title}}}
\author{{}}
\date{{\today}}

\begin{{document}}
\maketitle
\pagenumbering{{roman}}

{front}

\tableofcontents
\clearpage
\pagenumbering{{arabic}}

{body}

\bibliographystyle{{{bib}}}
\bibliography{{references}}
\end{{document}}"""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/project/{project_id}/content", response_model=list[GeneratedSectionRead], status_code=status.HTTP_201_CREATED)
def generate_content(
    project_id: UUID,
    payload: GenerateContentRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[GeneratedContent]:
    project = get_owned_project(project_id, user, db)
    template = db.scalar(
        select(Template).where(Template.project_id == project_id).order_by(Template.created_at.desc())
    )
    questionnaire = db.scalar(
        select(Questionnaire)
        .where(Questionnaire.project_id == project_id)
        .order_by(Questionnaire.created_at.desc())
    )
    generated = AIContentService().generate_sections(
        project={"title": project.title, "domain": project.domain, "description": project.description},
        template=template.profile if template else None,
        answers=questionnaire.answers if questionnaire else {},
        sections=payload.sections,
        length=payload.length,
        api_key=x_openai_api_key,
    )
    rows = [
        GeneratedContent(
            project_id=project_id,
            section=item["section"],
            content=item["content"],
            meta=item.get("meta", {}),
        )
        for item in generated
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


@router.post("/enhance-answers-public")
async def enhance_answers_public(
    payload: EnhanceAnswersRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    active_answers = []
    for key, val in payload.answers.items():
        if val and not is_nil_answer(val):
            q_label = next((q.label for q in payload.questions if q.id == key), key)
            active_answers.append(f"{q_label}: {val}")

    if not active_answers:
        return {k: ("" if is_nil_answer(v) else v) for k, v in payload.answers.items()}

    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        return {k: ("" if is_nil_answer(v) else v) for k, v in payload.answers.items()}

    prompt = f"""You are an academic writing assistant. Enhance the following answers for an academic project questionnaire.
Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

Student answers:
{chr(10).join(active_answers)}

Rewrite each answer as a formal academic paragraph. Return a JSON object where keys are the original question IDs and values are the rewritten paragraphs. Return ONLY the JSON object."""

    try:
        client, model = get_openai_client_and_model(api_key)
        kwargs: dict = dict(
            model=model,
            messages=[
                {"role": "system", "content": "Return only a valid JSON object mapping question IDs to enhanced paragraphs."},
                {"role": "user", "content": prompt},
            ],
        )
        if "gemini" not in model.lower():
            kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**kwargs)
        raw = _extract_ai_text(response).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"```\s*$", "", raw).strip()
        parsed = json.loads(raw)
        return {k: ("" if is_nil_answer(v) else parsed.get(k, v)) for k, v in payload.answers.items()}
    except Exception as e:
        print(f"Error enhancing answers: {e}")
        return {k: ("" if is_nil_answer(v) else v) for k, v in payload.answers.items()}


@router.post("/generate-answers-public")
async def generate_answers_public(
    payload: EnhanceAnswersRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    api_key = x_openai_api_key or settings.openai_api_key

    questions_block = "\n".join(
        f'- id="{q.id}" | "{q.label}"'
        for q in payload.questions
    )
    existing_block = "\n".join(
        f'- {q.id}: {payload.answers.get(q.id, "")}'
        for q in payload.questions
        if payload.answers.get(q.id) and not is_nil_answer(payload.answers.get(q.id, ""))
    ) or "None"

    prompt = f"""You are an expert academic writer. Generate complete, realistic, technically accurate answers
for a university final-year project questionnaire.

Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

Questions to answer:
{questions_block}

Already answered (preserve these unless empty):
{existing_block}

Rules:
- Write in formal academic English suitable for a university report.
- Each answer: 2-5 sentences, specific to this project domain and description.
- For technical fields infer realistic plausible values from the description.
- Return ONLY a JSON object where keys = question id, values = answer strings.
- No markdown. No code fences. No explanation. Raw JSON only."""

    if not api_key:
        fallback = {}
        for q in payload.questions:
            existing = payload.answers.get(q.id, "")
            fallback[q.id] = existing if (existing and not is_nil_answer(existing)) else f"[Answer for: {q.label}]"
        return {"answers": fallback}

    try:
        client, model = get_openai_client_and_model(api_key)
        kwargs: dict = dict(
            model=model,
            messages=[
                {"role": "system", "content": "Return only a valid JSON object mapping question IDs to answer strings. No markdown, no code fences, no explanation."},
                {"role": "user", "content": prompt},
            ],
        )
        if "gemini" not in model.lower():
            kwargs["response_format"] = {"type": "json_object"}

        response = client.chat.completions.create(**kwargs)
        raw = _extract_ai_text(response)

        print("=" * 60)
        print("RAW GENERATE-ANSWERS RESPONSE:")
        print(repr(raw[:500]))
        print("=" * 60)

        if not raw or not raw.strip():
            raise ValueError("Empty response from AI model")

        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"```\s*$", "", raw).strip()

        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end == 0:
            raise ValueError(f"No JSON object found in response: {raw[:200]}")
        parsed = json.loads(raw[start:end])

        merged = {}
        for q in payload.questions:
            existing = payload.answers.get(q.id, "")
            merged[q.id] = existing if (existing and not is_nil_answer(existing)) else parsed.get(q.id, "")
        return {"answers": merged}

    except Exception as e:
        print(f"Error generating answers: {e}")
        import traceback
        traceback.print_exc()
        return {"answers": {q.id: payload.answers.get(q.id, "") for q in payload.questions}}


@router.post("/generate-report-public")
async def generate_report_public(
    payload: GenerateReportRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    print("<<<<<<<<<<<< GENERATE REPORT >>>>>>>>>>>>>>")

    api_key = x_openai_api_key or settings.openai_api_key
    print("API KEY:", api_key[:10] + "..." if api_key else "NONE")

    if not api_key:
        print("NO API KEY -> FALLBACK")
        return {"latex": _build_fallback_latex(payload)}

    active_answers = []
    for key, val in payload.answers.items():
        if val and not is_nil_answer(val):
            q_label = next((q.label for q in payload.questions if q.id == key), key)
            active_answers.append(f"- {q_label}: {val}")

    answers_str = "\n".join(active_answers) if active_answers else "None provided"

    raw_chapters = payload.templateProfile.chapters if payload.templateProfile else None
    chapters = _validate_chapters(raw_chapters) or DEFAULT_CHAPTERS

    FRONT_MATTER = {"certificate", "declaration", "acknowledgement",
                    "table of contents", "contents", "list of figures", "list of tables"}
    body_chapters = [c for c in chapters if c.lower() not in FRONT_MATTER]
    chapters_instruction = "Use exactly these chapters in order: " + ", ".join(body_chapters)

    style_lines = []
    if payload.templateProfile:
        if payload.templateProfile.citation:
            style_lines.append(f"Citation style: {payload.templateProfile.citation}.")
        try:
            spacing = float(payload.templateProfile.spacing or "1.5")
            if spacing >= 1.8:
                style_lines.append(r"Use \renewcommand{\baselinestretch}{2.0} for double spacing.")
            elif spacing >= 1.3:
                style_lines.append(r"Use \renewcommand{\baselinestretch}{1.5} for one-and-a-half spacing.")
            else:
                style_lines.append(r"Use \renewcommand{\baselinestretch}{1.0} for single spacing.")
        except Exception:
            style_lines.append(r"Use \renewcommand{\baselinestretch}{1.5} for one-and-a-half spacing.")

    prompt = f"""
You are an expert academic report writer specializing in university final-year engineering project reports.

Generate a COMPLETE professional LaTeX report.

PROJECT INFORMATION

Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

PROJECT DETAILS PROVIDED BY THE STUDENT

{answers_str}

REPORT CHAPTERS

{chapters_instruction}

FORMATTING REQUIREMENTS

{chr(10).join(style_lines) or "Use one-and-a-half line spacing."}

STRICT RULES

1. Return ONLY raw LaTeX.
2. Do NOT use markdown.
3. Do NOT wrap the response in ```latex.
4. Begin with:

\\documentclass[12pt,a4paper]{{report}}

5. Include ONLY these packages (all are guaranteed to be installed):

\\usepackage[a4paper,margin=1in]{{geometry}}
\\usepackage{{graphicx}}
\\usepackage[hidelinks]{{hyperref}}
\\usepackage{{titlesec}}
\\usepackage{{fancyhdr}}
\\usepackage{{booktabs}}
\\usepackage{{caption}}
\\usepackage{{float}}
\\usepackage{{amsmath}}
\\usepackage{{amssymb}}
\\usepackage{{longtable}}
\\usepackage{{parskip}}

6. For line spacing use ONLY this (do NOT use the setspace package):

\\renewcommand{{\\baselinestretch}}{{1.5}}

7. Configure page numbers:

\\pagestyle{{fancy}}
\\fancyhf{{}}
\\fancyfoot[C]{{\\thepage}}
\\renewcommand{{\\headrulewidth}}{{0pt}}

8. Create a professional title page.

9. Include: Certificate, Declaration, Acknowledgement, Abstract, Table of Contents, List of Figures, List of Tables.

10. Use Roman page numbering for preliminary pages. Switch to Arabic after the table of contents.

11. Follow the exact chapter order supplied.

12. Every chapter MUST start with \\chapter{{Chapter Name}}.

13. Every chapter must contain multiple \\section{{}} and \\subsection{{}} headings.

14. Every chapter should contain 6-10 detailed academic paragraphs.

15. Include technical explanations, algorithms, implementation details, system architecture, workflow, advantages, limitations, and analysis wherever appropriate.

16. Mention figures and tables naturally: Figure~\\ref{{fig:architecture}}, Table~\\ref{{tab:results}}.

17. Use citation placeholders: \\cite{{ref1}}, \\cite{{ref2}}.

18. Write in formal academic language suitable for university submission.

19. Do NOT generate placeholder text such as "Lorem ipsum", "Hello World", or "Content goes here".

20. Produce a report of approximately 40-80 pages when compiled.

21. The document must compile successfully without requiring additional edits.

22. NEVER use \\item outside of a \\begin{itemize}, \\begin{enumerate}, or \\begin{description} environment. Every \\item MUST be inside one of these environments. Always close the environment with \\end{itemize} or \\end{enumerate} before starting a new section.

23. NEVER use \\hline outside of a tabular environment.

24. NEVER use \\\\ (double backslash line break) in normal paragraph text — only inside tabular/array environments.

25. NEVER write a bare underscore _ or caret ^ in normal paragraph text. These cause "Missing $ inserted" LaTeX errors. Always wrap identifiers with underscores inside \\texttt{{...}} or inside $...$ math mode.

26. NEVER use \\includegraphics with placeholder or invented filenames like 'placeholder.png', 'image.png', 'figure.png', 'sample.png', 'dummy.png', or any filename that does not exist. For figures, use this exact compilable placeholder pattern:

\\begin{{figure}}[H]
\\centering
\\fbox{{\\parbox{{0.6\\linewidth}}{{\\centering\\bigskip Figure: Description of diagram or chart \\bigskip}}}}
\\caption{{Caption text here.}}
\\label{{fig:label}}
\\end{{figure}}

27. NEVER use \\graphicspath. NEVER use \\includegraphics at all. Use ONLY the \\fbox{{\\parbox{{...}}{{...}}}} pattern above for every figure.

Return ONLY the LaTeX source from \\documentclass to \\end{{document}}.
"""

    try:
        client, model = get_openai_client_and_model(api_key)
        print("Provider model:", model)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Output ONLY raw LaTeX."},
                {"role": "user",   "content": prompt},
            ],
        )

        content = _extract_ai_text(response).strip()
        content = re.sub(r"^```latex\s*", "", content, flags=re.IGNORECASE)
        content = re.sub(r"^```\s*",      "", content)
        content = re.sub(r"```\s*$",      "", content).strip()

        # ── Backend sanitise pass: fix endcsname triggers before returning ──
        import re as _re

        def _sanitise_label(arg: str) -> str:
            """Remove chars that cause endcsname errors from label/ref arguments."""
            return (_re.sub(r'[_^&$#%~{}\\]', '-', arg)
                      .replace(' ', '-')
                      .replace('--', '-')
                      .strip('-'))

        # Fix \label{}, \ref{}, \pageref{}, \autoref{}, \nameref{}, \eqref{}
        def _fix_label_args(src: str) -> str:
            return _re.sub(
                r'\\(label|ref|pageref|autoref|nameref|eqref|cite|bibitem)\{([^}]+)\}',
                lambda m: f'\\{m.group(1)}{{{_sanitise_label(m.group(2))}}}',
                src
            )

        # Fix \hyperref[label]{text}
        def _fix_hyperref(src: str) -> str:
            return _re.sub(
                r'\\hyperref\[([^\]]+)\]',
                lambda m: f'\\hyperref[{_sanitise_label(m.group(1))}]',
                src
            )

        # Remove setspace package and its commands
        def _fix_setspace(src: str) -> str:
            src = _re.sub(r'\\usepackage(?:\[[^\]]*\])?\{setspace\}\n?', '', src)
            src = _re.sub(r'\\(onehalfspacing|doublespacing|singlespacing)\n?', '', src)
            return src

        # Remove \includegraphics with any filename (they all fail — no images on server)
        def _fix_graphics(src: str) -> str:
            src = _re.sub(r'\\graphicspath\{[^}]*\}\n?', '', src)
            src = _re.sub(
                r'\\includegraphics(?:\[[^\]]*\])?\{[^}]*\}',
                r'\\fbox{\\parbox{0.6\\linewidth}{\\centering Figure placeholder}}',
                src
            )
            return src

        content = _fix_label_args(content)
        content = _fix_hyperref(content)
        content = _fix_setspace(content)
        content = _fix_graphics(content)

        print("BACKEND SANITISE PASS COMPLETE")

        # ── Diagnostic: scan for endcsname triggers before returning ──
        import re as _re
        lines = content.split("\n")
        print("=" * 60)
        print(f"LATEX OUTPUT: {len(lines)} lines, {len(content)} chars")
        
        # Find all \label, \ref, \hyperref with special chars
        bad_label_pattern = _re.compile(
            r'\\(label|ref|pageref|autoref|nameref|eqref|hyperref)[\[{]([^\]}\]]*[_^&$#%~][^\]}\]*)[}\]]'
        )
        for i, line in enumerate(lines, 1):
            m = bad_label_pattern.search(line)
            if m:
                print(f"  ENDCSNAME RISK L{i}: {repr(line.strip()[:120])}")
        
        # Find \usepackage{setspace}
        for i, line in enumerate(lines, 1):
            if 'setspace' in line or 'onehalfspacing' in line or 'doublespacing' in line:
                print(f"  SETSPACE L{i}: {repr(line.strip())}")
        
        # Find \includegraphics
        for i, line in enumerate(lines, 1):
            if '\\includegraphics' in line or r'\includegraphics' in line:
                print(f"  INCLUDEGRAPHICS L{i}: {repr(line.strip()[:120])}")

        # Show lines 930-970 (where errors are occurring)
        print("\nLINES 925-970:")
        for i, line in enumerate(lines[924:969], 925):
            print(f"  {i}: {repr(line[:100])}")
        print("=" * 60)
        
        return {"latex": content}

    except Exception:
        import traceback
        traceback.print_exc()
        raise


@router.post("/questions-public")
async def generate_questions_public(
    payload: GenerateQuestionsRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    raw_chapters = payload.templateProfile.chapters if payload.templateProfile else None
    chapters = _validate_chapters(raw_chapters)
    chapters_str = ", ".join(chapters) if chapters else "Standard academic chapters"

    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        return {"questions": [
            {"id": "problem_statement", "label": "What specific problem does your project solve?",           "type": "textarea"},
            {"id": "objectives",        "label": "What are the primary objectives of the project?",          "type": "textarea"},
            {"id": "scope",             "label": "What is included and excluded from the project scope?",    "type": "textarea"},
            {"id": "existing_system",   "label": "Describe the existing/current system and its limitations.", "type": "textarea"},
            {"id": "proposed_system",   "label": "Describe your proposed system and how it improves on the existing one.", "type": "textarea"},
            {"id": "tech_stack",        "label": "What technologies, tools, and frameworks are used?",       "type": "textarea"},
            {"id": "testing_methods",   "label": "How was the system tested and what were the results?",     "type": "textarea"},
        ]}

    prompt = f"""Generate 7-9 specific questionnaire questions to gather student details for a high-quality academic report.

Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}
Template Chapters: {chapters_str}

Return a JSON object with key "questions" containing an array. Each item must have:
- "id": unique snake_case identifier
- "label": specific question text tailored to this project's domain
- "type": "text" or "textarea"

Cover: problem statement, objectives, scope, existing vs proposed system, tech stack/architecture, implementation details, testing approach, results/outcomes. Make questions specific to this domain and description."""

    try:
        client, model = get_openai_client_and_model(api_key)
        kwargs: dict = dict(
            model=model,
            messages=[
                {"role": "system", "content": 'Return only a valid JSON object with key "questions".'},
                {"role": "user",   "content": prompt},
            ],
        )
        if "gemini" not in model.lower():
            kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**kwargs)
        raw = _extract_ai_text(response).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"```\s*$", "", raw).strip()
        return json.loads(raw)
    except Exception as e:
        print(f"Error generating questions: {e}")
        return {"questions": [
            {"id": "problem_statement", "label": "What specific problem does your project solve?", "type": "textarea"},
            {"id": "objectives",        "label": "What are the primary objectives of the project?", "type": "textarea"},
        ]}


@router.post("/assist", response_model=ResearchAssistResponse)
def research_assist(
    payload: ResearchAssistRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
) -> dict:
    return AIContentService().research_assist(
        prompt=payload.prompt,
        selected_text=payload.selected_text,
        full_source=payload.full_source,
        api_key=x_openai_api_key,
    )


@router.post("/polish-latex")
async def polish_latex(
    payload: PolishLatexRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    """AI-powered LaTeX polish pass — removes placeholders, fixes tables, normalises formatting."""
    api_key = x_openai_api_key or settings.openai_api_key

    if not api_key:
        return {"latex_source": _basic_clean(payload.latex_source)}

    source = payload.latex_source
    MAX_CHARS = 14_000
    truncated = False
    if len(source) > MAX_CHARS:
        half = MAX_CHARS // 2
        source_for_ai = (
            source[:half]
            + "\n\n% ... [middle section preserved, not sent for polish] ...\n\n"
            + source[-half:]
        )
        truncated = True
    else:
        source_for_ai = source

    prompt = f"""You are an expert LaTeX editor. Polish the following LaTeX source for a university project report.

Project Title: {payload.project.title}
Domain: {payload.project.domain}

TASKS (in order of priority):
1. Remove ALL placeholder text: "lorem ipsum", "[Answer for: ...]", "Content goes here", "Hello World", "Detailed content for the X phase will be populated...", "[Figure here]", "[Table here]", "[Citation needed]", "TODO", "FIXME". Replace with realistic academic content based on the project title and domain.
2. Fix malformed LaTeX table environments (unbalanced & columns, missing \\hline, broken longtable).
3. Ensure every \\begin{{figure}} has a matching \\caption and \\label.
4. Ensure every \\begin{{table}} has a matching \\caption and \\label.
5. Fix duplicate \\section or \\chapter headings.
6. Remove triple+ blank lines.
7. Fix obvious \\ref{{}} and \\cite{{}} mismatches.
8. Do NOT change correct academic content, chapter structure, or package declarations.
9. Return ONLY the complete corrected LaTeX source. No explanation. No markdown.

LaTeX source:

{source_for_ai}"""

    try:
        client, model = get_openai_client_and_model(api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Output ONLY the corrected LaTeX source starting with \\documentclass. No markdown, no fences."},
                {"role": "user",   "content": prompt},
            ],
        )

        content = _extract_ai_text(response).strip()
        content = re.sub(r"^```latex\s*", "", content, flags=re.IGNORECASE)
        content = re.sub(r"^```\s*",      "", content)
        content = re.sub(r"```\s*$",      "", content).strip()

        if content and (content.startswith("\\") or content.startswith("%")):
            if truncated:
                half = MAX_CHARS // 2
                original_middle = payload.latex_source[half:-half]
                mid_marker = "% ... [middle section preserved"
                if mid_marker in content:
                    ai_start, ai_end = content.split(mid_marker, 1)
                    ai_end = ai_end.split("\n", 1)[-1] if "\n" in ai_end else ai_end
                    return {"latex_source": ai_start + original_middle + ai_end}
            return {"latex_source": content}

        print(f"Polish: unexpected AI output, falling back. Preview: {content[:100]}")
        return {"latex_source": _basic_clean(payload.latex_source)}

    except Exception as e:
        print(f"Error polishing LaTeX: {e}")
        import traceback
        traceback.print_exc()
        return {"latex_source": _basic_clean(payload.latex_source)}