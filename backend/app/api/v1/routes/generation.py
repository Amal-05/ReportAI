from uuid import UUID
import re

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel
from openai import OpenAI

from app.core.config import settings
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


class GenerateReportRequest(BaseModel):
    project: ProjectInfo
    answers: dict[str, str]
    questions: list[QuestionInfo]


class TemplateProfileInfo(BaseModel):
    chapters: list[str] | None = None
    citation: str | None = None
    font: str | None = None
    spacing: str | None = None


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
async def enhance_answers_public(payload: EnhanceAnswersRequest):
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

    if not settings.openai_api_key:
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
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
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
async def generate_report_public(payload: GenerateReportRequest):
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
        
        answer_text_lines = []
        for key, val in payload.answers.items():
            if val and not is_nil_answer(val):
                clean_key = key.replace("_", " ")
                answer_text_lines.append(f"{clean_key}: {val}")
        answer_text = "\\\\\n".join(answer_text_lines)

        sections_tex = []
        for section in report_sections:
            sec_tex = f"\\chapter{{{section}}}\n"
            sec_tex += f"{payload.project.title} is an academic project in the {payload.project.domain} domain. {payload.project.description}\n\n"
            sec_tex += "\\section{Project Evidence}\n"
            sec_tex += f"{answer_text if answer_text else 'Project-specific evidence should be added through the questionnaire.'}"
            sections_tex.append(sec_tex)
        
        sections_joined = "\n\n".join(sections_tex)

        return f"""\\documentclass[12pt,a4paper]{{report}}
\\usepackage[margin=1in]{{geometry}}
\\usepackage{{setspace}}
\\usepackage{{hyperref}}
\\onehalfspacing
\\title{{{payload.project.title}}}
\\author{{Generated by ReportAI}}
\\date{{\\today}}
\\begin{{document}}
\\maketitle
\\tableofcontents

{sections_joined}

\\bibliographystyle{{IEEEtran}}
\\bibliography{{references}}
\\end{{document}}"""

    if not settings.openai_api_key:
        return {"latex": get_fallback_latex()}

    prompt = f"""You are a world-class academic LaTeX writing system. Write a comprehensive, highly detailed academic project report in LaTeX for the following project:

Project Title: {payload.project.title}
Domain: {payload.project.domain}
Description: {payload.project.description}

Student Questionnaire Details:
{answers_str}

Instructions:
1. Generate a complete, compiler-ready LaTeX document starting with \\documentclass[12pt,a4paper]{{report}} and ending with \\end{{document}}.
2. Use standard report chapters: Abstract, Introduction, Literature Review, Methodology, System Design, Implementation, Testing, Results, and Conclusion.
3. Enhance all questionnaire details and write them contextually into highly detailed paragraphs (using academic tone, formal vocabulary, and scientific formatting).
4. Organize the layout elegantly: use subsections, bullet lists (itemize/enumerate), and LaTeX layout wrappers where appropriate.
5. Include a Table of Contents (\\tableofcontents) and Title Page (\\maketitle).
6. Do NOT wrap the LaTeX output in markdown ticks (e.g. ```latex ... ```). The output must be the raw LaTeX source string directly."""

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
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
async def generate_questions_public(payload: GenerateQuestionsRequest):
    chapters_str = ", ".join(payload.templateProfile.chapters) if (payload.templateProfile and payload.templateProfile.chapters) else "None extracted yet"
    
    if not settings.openai_api_key:
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
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
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


