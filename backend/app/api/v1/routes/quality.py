from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_project
from app.db.session import get_db
from app.models.content import GeneratedContent
from app.models.reference import Reference
from app.models.user import User
from app.schemas.quality import QualityScore
from app.services.latex_generator import LaTeXGenerator
from app.services.quality_analyzer import QualityAnalyzer

router = APIRouter()


@router.get("/project/{project_id}", response_model=QualityScore)
def analyze_project_quality(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    project = get_owned_project(project_id, user, db)
    sections = list(db.scalars(select(GeneratedContent).where(GeneratedContent.project_id == project_id)))
    references = list(db.scalars(select(Reference).where(Reference.project_id == project_id)))
    latex_source, _ = LaTeXGenerator().render_report(
        {"title": project.title, "domain": project.domain},
        [{"section": section.section, "content": section.content} for section in sections],
    )
    return QualityAnalyzer().score(latex_source, [reference.__dict__ for reference in references])
