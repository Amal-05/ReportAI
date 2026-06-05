from uuid import UUID
import re

from fastapi import APIRouter, Depends, status, Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel
from openai import OpenAI

from app.core.config import settings
from app.core.ai_utils import get_openai_client_and_model
from app.api.deps import get_current_user, get_owned_project
from app.db.session import get_db
from app.models.content import GeneratedContent
from app.models.questionnaire import Questionnaire
from app.models.template import Template
from app.models.user import User
from app.schemas.generation import GenerateContentRequest, GeneratedSectionRead
from app.services.ai_content import AIContentService

router = APIRouter()


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



def is_nil_answer(value: str) -> bool:
    if not value:
        return True
    clean = value.strip().lower()
    return clean in [
        "", "nil", "none", "nothing", "n/a", "na", 
        "not applicable", "null", "no", "none.", "nil."
    ]


@router.post("/project/{project_id}/content", response_model=list[GeneratedSectionRead], status_code=status.HTTP_201_CREATED)
def generate_content(
    project_id: UUID,
    payload: GenerateContentRequest,
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
        project={
            "title": project.title,
            "domain": project.domain,
            "description": project.description,
        },
        template=template.profile if template else None,
        answers=questionnaire.answers if questionnaire else {},
        sections=payload.sections,
        length=payload.length,
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
            q_label = key
            for q in payload.questions:
                if q.id == key:
                    q_label = q.label
                    break
            active_answers.append(f"{q_label}: {val}")

    if not active_answers:
        next_answers = {}
        for key, val in payload.answers.items():
            if is_nil_answer(val):
                next_answers[key] = ""
            else:
                next_answers[key] = val
        return next_answers

    active_answers_str = "\n\n".join(active_answers)

    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        next_answers = {}
        for key, val in payload.answers.items():
            if is_nil_answer(val):
                next_answers[key] = ""
            else:
                next_answers[key] = val
        return next_answers

    prompt = f"""You are an academic writing assistant. Enhance the following point-form or informal answers provided by a student for their academic project questionnaire.
Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

Here are the student's raw answers:
{active_answers_str}

Instructions:
1. Rewrite each answer into a highly professional, well-structured, formal academic paragraph.
2. Maintain technical accuracy but enhance vocabulary, grammar, and flow.
3. Return the output strictly as a JSON object where the keys are the original question IDs (e.g. "problem_statement", "tech_stack") and the values are the rewritten academic paragraphs. Do not return any other text, markdown formatting, or explain anything."""

    try:
        client, model = get_openai_client_and_model(api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an academic advisor. You must return only a valid JSON object mapping question IDs to enhanced text paragraphs. Do not return any markdown code blocks, explanations, or other text."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={ "type": "json_object" }
        )
        import json
        parsed = json.loads(response.choices[0].message.content.strip())
        
        next_answers = {}
        for key, val in payload.answers.items():
            if is_nil_answer(val):
                next_answers[key] = ""
            elif key in parsed:
                next_answers[key] = parsed[key]
            else:
                next_answers[key] = val
        return next_answers
    except Exception as e:
        print(f"Error enhancing answers: {e}")
        next_answers = {}
        for key, val in payload.answers.items():
            if is_nil_answer(val):
                next_answers[key] = ""
            else:
                next_answers[key] = val
        return next_answers


@router.post("/generate-report-public")
async def generate_report_public(
    payload: GenerateReportRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    active_answers = []
    for key, val in payload.answers.items():
        if val and not is_nil_answer(val):
            q_label = key
            for q in payload.questions:
                if q.id == key:
                    q_label = q.label
                    break
            active_answers.append(f"- {q_label}: {val}")

    answers_str = "\n".join(active_answers) if active_answers else "None provided"

    def get_fallback_latex():
        report_sections = [
            "Abstract",
            "Acknowledgement",
            "Introduction",
            "Literature Review",
            "System Analysis",
            "System Design",
            "Methodology",
            "Implementation",
            "Testing",
            "Results",
            "Conclusion",
            "Future Scope",
        ]
        if payload.templateProfile and payload.templateProfile.chapters:
            report_sections = payload.templateProfile.chapters
        
        # Map specific question keys/patterns to LaTeX chapters to avoid duplicate content on all pages
        chapter_mappings = {
            "Abstract": ["abstract", "problem_statement"],
            "Acknowledgement": [],
            "Introduction": ["objectives", "scope"],
            "Literature Review": ["literature_review", "background"],
            "System Analysis": ["system_analysis", "requirements"],
            "System Design": ["system_design", "hardware_architecture", "tech_stack", "software_architecture", "database_design"],
            "Methodology": ["methodology", "implementation_tools", "system_architecture"],
            "Implementation": ["implementation", "hardware_protocol", "power_control"],
            "Testing": ["testing_methods", "test_cases"],
            "Results": ["results", "evaluation_metrics"],
            "Conclusion": ["conclusion"],
            "Future Scope": ["future_scope"]
        }

        sections_tex = []
        for section in report_sections:
            sec_tex = f"\\chapter{{{section}}}\n"
            
            # Gather answers belonging to this section
            section_keys = chapter_mappings.get(section, [])
            section_answers = []
            
            # For custom sections, attempt dynamic match by substring mapping
            if not section_keys:
                normalized_section = section.lower().replace(" ", "_")
                for ans_key, ans_val in payload.answers.items():
                    if ans_val and not is_nil_answer(ans_val):
                        if normalized_section in ans_key or ans_key in normalized_section:
                            clean_key = ans_key.replace("_", " ").title()
                            section_answers.append(f"\\textbf{{{clean_key}}}: {ans_val}")
            else:
                for key in section_keys:
                    for ans_key, ans_val in payload.answers.items():
                        if ans_val and not is_nil_answer(ans_val):
                            if ans_key == key or key in ans_key or ans_key in key:
                                clean_key = ans_key.replace("_", " ").title()
                                section_answers.append(f"\\textbf{{{clean_key}}}: {ans_val}")
            
            # Set specific descriptive paragraphs per section to look premium and distinct
            if section == "Abstract":
                sec_tex += f"This document presents the project report for \\textbf{{{payload.project.title}}}, an academic work in the {payload.project.domain} domain.\n\n"
                sec_tex += f"{payload.project.description}\n\n"
            elif section == "Acknowledgement":
                sec_tex += f"The authors would like to express their sincere gratitude to project advisors, classmates, and all contributors who provided feedback and assistance during the development of \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "Introduction":
                sec_tex += f"The primary focus of this study is the exploration and development of \\textbf{{{payload.project.title}}}. This chapter details the foundational concepts, background, objectives, and project boundaries defined for this academic research.\n\n"
            elif section == "Literature Review":
                sec_tex += f"An analysis of prior studies and state-of-the-art developments in the field of {payload.project.domain} was conducted. This chapter reviews the academic theories, methodologies, and frameworks relevant to \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "System Analysis":
                sec_tex += f"This chapter outlines the requirements analysis, functional specifications, feasibility study, and data flow modeling executed to formulate the architecture of \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "System Design":
                sec_tex += f"The system design presents the structural layout, component boundaries, database schemas, and architectural design patterns selected to construct \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "Methodology":
                sec_tex += f"The core methodology describes the theoretical algorithms, processing pipelines, testing models, and experimental layouts configured for the validation of \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "Implementation":
                sec_tex += f"This chapter documents the environment setup, API services, libraries, hardware configurations, and code compilation details executed to instantiate the functional prototype of \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "Testing":
                sec_tex += f"Validation and verification tests were executed to confirm the operational capability of \\textbf{{{payload.project.title}}}. This includes modular unit tests and systemic integration audits.\n\n"
            elif section == "Results":
                sec_tex += f"The performance outcomes, evaluation metrics, comparative tables, and data logs achieved during research trials of \\textbf{{{payload.project.title}}} are presented and analyzed in this section.\n\n"
            elif section == "Conclusion":
                sec_tex += f"This chapter concludes the research findings, achievements, and lessons learned during the development of \\textbf{{{payload.project.title}}}.\n\n"
            elif section == "Future Scope":
                sec_tex += f"Potential future enhancements, scalability optimizations, and cloud deployment pipelines proposed for \\textbf{{{payload.project.title}}} are outlined in this section.\n\n"
            else:
                sec_tex += f"This chapter details the specific research, design paradigms, and analytical evaluations concerning the {section.title()} phase of \\textbf{{{payload.project.title}}}.\n\n"

            if section_answers:
                sec_tex += "\\section{Project Evidence}\n"
                sec_tex += "\\\\\n".join(section_answers) + "\n"
            else:
                if section not in ["Abstract", "Acknowledgement"]:
                    sec_tex += f"Further investigations and data compilation for the {section.lower()} phase are ongoing.\n"
            
            sections_tex.append(sec_tex)
        
        sections_joined = "\n\n".join(sections_tex)

        spacing_tex = "\\onehalfspacing"
        if payload.templateProfile and payload.templateProfile.spacing:
            try:
                sp = float(payload.templateProfile.spacing)
                if sp >= 1.8:
                    spacing_tex = "\\doublespacing"
                elif sp < 1.3:
                    spacing_tex = "\\singlespacing"
            except Exception:
                pass

        bib_style = "IEEEtran"
        if payload.templateProfile and payload.templateProfile.citation:
            cit = payload.templateProfile.citation.lower()
            if "apa" in cit:
                bib_style = "apalike"
            elif "harvard" in cit:
                bib_style = "apalike"

        return f"""% Compiled in local offline fallback mode.
% To enable high-quality dynamic academic report generation, please configure the NEXT_PUBLIC_OPENAI_API_KEY environment variable.
\\documentclass[12pt,a4paper]{{report}}
\\usepackage[margin=1in]{{geometry}}
\\usepackage{{setspace}}
\\usepackage{{hyperref}}
{spacing_tex}
\\title{{{payload.project.title}}}
\\author{{Generated by ReportAI}}
\\date{{\\today}}
\\begin{{document}}
\\maketitle
\\tableofcontents

{sections_joined}

\\bibliographystyle{{{bib_style}}}
\\bibliography{{references}}
\\end{{document}}"""

    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        return {"latex": get_fallback_latex()}

    chapters_instruction = ""
    if payload.templateProfile and payload.templateProfile.chapters:
        chapters_list_str = ", ".join(payload.templateProfile.chapters)
        chapters_instruction = f"Use the following exact chapters in this exact order: {chapters_list_str}."
    else:
        chapters_instruction = "Use standard report chapters: Abstract, Introduction, Literature Review, Methodology, System Design, Implementation, Testing, Results, and Conclusion."

    style_instructions = []
    if payload.templateProfile:
        if payload.templateProfile.citation:
            style_instructions.append(f"Follow the {payload.templateProfile.citation} citation style guidelines.")
        if payload.templateProfile.font:
            style_instructions.append(f"Format text elements to align with the {payload.templateProfile.font} font style guidelines.")
        if payload.templateProfile.spacing:
            try:
                spacing_val = float(payload.templateProfile.spacing)
                if spacing_val >= 1.8:
                    style_instructions.append("Use double line spacing (include \\doublespacing from the setspace package).")
                elif spacing_val >= 1.3:
                    style_instructions.append("Use one-half line spacing (include \\onehalfspacing from the setspace package).")
                else:
                    style_instructions.append("Use single line spacing (include \\singlespacing from the setspace package).")
            except Exception:
                pass
    style_inst_str = "\n".join(f"- {inst}" for inst in style_instructions) if style_instructions else ""

    prompt = f"""You are a world-class academic LaTeX writing system. Write a comprehensive, highly detailed academic project report in LaTeX for the following project:

Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

Student Questionnaire Details:
{answers_str}

Structural Chapters:
{chapters_instruction}

Styling Guidelines:
{style_inst_str}

Instructions:
1. Generate a complete, compiler-ready LaTeX document starting with \\documentclass[12pt,a4paper]{{report}} and ending with \\end{{document}}.
2. Organize the LaTeX layout using the requested structural chapters.
3. Enhance all questionnaire details and write them contextually into highly detailed paragraphs (using academic tone, formal vocabulary, and scientific formatting).
4. Organize the layout elegantly: use subsections, bullet lists (itemize/enumerate), and LaTeX layout wrappers where appropriate.
5. Include a Table of Contents (\\tableofcontents) and Title Page (\\maketitle).
6. Do not use manual spacing commands such as \\vspace or \\hspace in titles, chapters, sections, or body content.
7. The \\title{{...}} value must be plain text only. Do not wrap the title in \\textbf, \\large, \\centerline, or any other formatting command.
8. Do not use custom list options such as [label=...], [leftmargin=...], or enumitem-specific syntax. Use plain \\begin{{itemize}}, \\begin{{enumerate}}, and \\item only.
9. Do not include lstlisting, minted, verbatim, raw JSON/code dumps, or unresolved \\ref references unless the referenced label is also defined in the document.
10. Do NOT wrap the LaTeX output in markdown ticks (e.g. ```latex ... ```). The output must be the raw LaTeX source string directly."""

    try:
        client, model = get_openai_client_and_model(api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a LaTeX report writing system. You output ONLY raw LaTeX code. No explanations, no markdown blocks, no leading/trailing commentary."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = re.sub(r"^```latex\s*", "", content, flags=re.IGNORECASE)
            content = re.sub(r"^```\s*", "", content)
            content = re.sub(r"```$", "", content)
            content = content.strip()
        return {"latex": content}
    except Exception as e:
        print(f"Error generating LaTeX: {e}")
        return {"latex": get_fallback_latex()}


@router.post("/questions-public")
async def generate_questions_public(
    payload: GenerateQuestionsRequest,
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
):
    chapters_str = ", ".join(payload.templateProfile.chapters) if (payload.templateProfile and payload.templateProfile.chapters) else "None extracted yet"
    
    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        questions = [
            {"id": "problem_statement", "label": "What specific problem does your project solve?", "type": "textarea"},
            {"id": "objectives", "label": "What are the primary objectives of the project?", "type": "textarea"}
        ]
        if payload.templateProfile and payload.templateProfile.chapters:
            for chapter in payload.templateProfile.chapters:
                if chapter.lower() not in ["abstract", "acknowledgement", "conclusion"]:
                    questions.append({
                        "id": f"details_{chapter.lower().replace(' ', '_')}",
                        "label": f"Describe the key aspects to include in the '{chapter}' section.",
                        "type": "textarea"
                    })
        return {"questions": questions}

    prompt = f"""Based on the following project information and styling template guidelines, generate a list of 5 to 7 specific, highly relevant questionnaire questions (in English) to gather the necessary details from the student to generate a high-quality, comprehensive academic report.

Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}
Extracted Template Chapters: {chapters_str}

Return the output as a JSON object with a key "questions" containing an array of objects. Each object in the array must have exactly these fields:
- "id": A unique short identifier (using lowercase alphanumeric and underscores, e.g. "dataset_source")
- "label": The question text to display to the user (e.g. "What datasets will you use, and how will they be preprocessed?")
- "type": Either "text" (for short inputs) or "textarea" (for detailed descriptions).

Ensure the questions cover the core methodology, architecture/design, implementation details, evaluation/results, and challenges of the project. Do not generate generic questions; tailor them specifically to the project's domain and description."""

    try:
        client, model = get_openai_client_and_model(api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an academic advisor. You must return only a valid JSON object containing an array of questions under the key \"questions\". Do not return any other text, markdown formatting, or explanation."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={ "type": "json_object" }
        )
        import json
        parsed = json.loads(response.choices[0].message.content.strip())
        return parsed
    except Exception as e:
        print(f"Error generating AI questions: {e}")
        return {"questions": [
            {"id": "problem_statement", "label": "What specific problem does your project solve?", "type": "textarea"},
            {"id": "objectives", "label": "What are the primary objectives of the project?", "type": "textarea"}
        ]}
