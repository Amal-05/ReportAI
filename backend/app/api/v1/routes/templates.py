from uuid import UUID

from fastapi import APIRouter, Depends, File as UploadFileField, UploadFile, status, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_project
from app.db.session import get_db
from app.models.file import File
from app.models.template import Template
from app.models.user import User
from app.schemas.template import TemplateRead
from app.services.document_processor import DocumentProcessor
from app.services.storage import StorageService
from app.services.template_learning import TemplateLearningService

router = APIRouter()


@router.get("/project/{project_id}", response_model=list[TemplateRead])
def list_templates(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Template]:
    get_owned_project(project_id, user, db)
    return list(db.scalars(select(Template).where(Template.project_id == project_id)))


@router.post("/project/{project_id}/learn", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
async def learn_template(
    project_id: UUID,
    uploads: list[UploadFile] = UploadFileField(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Template:
    get_owned_project(project_id, user, db)
    processor = DocumentProcessor()
    storage = StorageService()
    documents = []

    for upload in uploads:
        content = await upload.read()
        storage_key = storage.put_bytes(content, upload.filename or "upload.bin", upload.content_type or "application/octet-stream")
        db.add(
            File(
                project_id=project_id,
                uploaded_by_id=user.id,
                filename=upload.filename or "upload.bin",
                content_type=upload.content_type or "application/octet-stream",
                storage_key=storage_key,
                purpose="template_source",
                size_bytes=len(content),
            )
        )
        documents.append(processor.extract(upload.filename or "", content))

    profile, confidence = TemplateLearningService().learn(documents)
    template = Template(
        project_id=project_id,
        name="Learned University Template",
        profile=profile,
        confidence=confidence,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.post("/learn-public", status_code=status.HTTP_200_OK)
async def learn_template_public(
    uploads: list[UploadFile] = UploadFileField(...),
    x_openai_api_key: str | None = Header(None, alias="X-OpenAI-API-Key"),
) -> dict:
    processor = DocumentProcessor()
    documents = []

    for upload in uploads:
        content = await upload.read()
        documents.append(processor.extract(upload.filename or "", content))

    full_text = "\n\n".join(doc.text for doc in documents)[:15000]
    
    from openai import OpenAI
    from app.core.config import settings
    from app.services.template_learning import TemplateLearningService
    
    api_key = x_openai_api_key or settings.openai_api_key
    if not api_key:
        profile, confidence = TemplateLearningService().learn(documents)
        questions = [
            {"id": "problem_statement", "label": "What specific problem does your project solve?", "type": "textarea"},
            {"id": "objectives", "label": "What are the primary objectives of the project?", "type": "textarea"}
        ]
        for chapter in profile.get("chapters", []):
            if chapter.lower() not in ["abstract", "acknowledgement", "conclusion"]:
                questions.append({
                    "id": f"details_{chapter.lower().replace(' ', '_')}",
                    "label": f"Describe the key aspects to include in the '{chapter}' section.",
                    "type": "textarea"
                })
        return {
            "profile": profile,
            "confidence": confidence,
            "questions": questions
        }

    client = OpenAI(api_key=api_key)
    prompt = f"""Analyze the following university report guidelines / sample document text and learn the required structure and styling parameters.
    
Guidelines Text:
{full_text}

Extract and generate a JSON object with these exact keys:
1. "chapters": A JSON array of the primary structural chapters/sections required for the report in correct order (e.g. ["Abstract", "Introduction", "Literature Review", "System Architecture", "Methodology", "Results", "Conclusion"]).
2. "citation": The expected citation format (e.g. "IEEE", "APA", "Harvard").
3. "font": The typography font name if specified (default: "Times New Roman").
4. "spacing": The line spacing value (default: "1.5").
5. "questions": A JSON array of 5 to 7 highly customized, project-specific and guideline-specific academic questions to ask the student in order to compile the content for these chapters. Each question object must have:
   - "id": unique lowercase alphanumeric key (e.g. "dataset_details", "hardware_pins")
   - "label": clear question text (e.g. "Detail the sensor specifications and connection ports used in your microcontroller design.")
   - "type": "text" or "textarea"

Return ONLY the raw JSON object. No explanations, no markdown styling."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a university report analysis bot. You must extract report parameters and return only valid JSON output."},
                {"role": "user", "content": prompt}
            ],
            response_format={ "type": "json_object" }
        )
        import json
        result = json.loads(response.choices[0].message.content.strip())
        profile = {
            "chapters": result.get("chapters", ["Abstract", "Introduction", "Literature Review", "Methodology", "Results", "Conclusion"]),
            "citation": result.get("citation", "IEEE"),
            "font": result.get("font", "Times New Roman"),
            "spacing": result.get("spacing", "1.5"),
            "heading_hierarchy": ["chapter", "section", "subsection"],
            "page_layout": {"paper": "A4", "margin": "1in"},
        }
        return {
            "profile": profile,
            "confidence": 0.95,
            "questions": result.get("questions", [])
        }
    except Exception as e:
        print(f"Error learning template via OpenAI: {e}")
        profile, confidence = TemplateLearningService().learn(documents)
        return {
            "profile": profile,
            "confidence": confidence,
            "questions": []
        }
