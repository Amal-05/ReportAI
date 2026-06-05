from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_project
from app.db.session import get_db
from app.models.content import GeneratedContent
from app.models.reference import Reference
from app.models.report import Report
from app.models.user import User
from app.schemas.report import CompileResult, LaTeXError, LaTeXFixRequest, ReportRead
from app.services.latex_generator import LaTeXGenerator
from app.services.pdf_compiler import PDFCompiler
from app.services.quality_analyzer import QualityAnalyzer
from app.services.storage import StorageService

router = APIRouter()


@router.get("/project/{project_id}", response_model=list[ReportRead])
def list_reports(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Report]:
    get_owned_project(project_id, user, db)
    return list(db.scalars(select(Report).where(Report.project_id == project_id).order_by(Report.version.desc())))


@router.post("/project/{project_id}/latex", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
def generate_latex_report(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Report:
    project = get_owned_project(project_id, user, db)
    sections = list(db.scalars(select(GeneratedContent).where(GeneratedContent.project_id == project_id)))
    references = list(db.scalars(select(Reference).where(Reference.project_id == project_id)))
    generator = LaTeXGenerator()
    latex_source, _ = generator.render_report(
        {"title": project.title, "domain": project.domain},
        [{"section": section.section, "content": section.content} for section in sections],
        generator.render_references([reference.bibtex for reference in references]),
    )
    storage = StorageService()
    latex_key = storage.put_bytes(latex_source.encode("utf-8"), "report.tex", "text/x-tex")
    latest_version = db.scalar(select(Report.version).where(Report.project_id == project_id).order_by(Report.version.desc())) or 0
    report = Report(project_id=project_id, version=latest_version + 1, status="latex_ready", latex_storage_key=latex_key)
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.post("/{report_id}/compile", response_model=CompileResult)
def compile_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CompileResult:
    report = db.get(Report, report_id)
    if report is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Report not found")
    project = get_owned_project(report.project_id, user, db)
    sections = list(db.scalars(select(GeneratedContent).where(GeneratedContent.project_id == project.id)))
    references = list(db.scalars(select(Reference).where(Reference.project_id == project.id)))
    generator = LaTeXGenerator()
    latex_source, line_map = generator.render_report(
        {"title": project.title, "domain": project.domain},
        [{"id": str(section.id), "section": section.section, "content": section.content} for section in sections],
    )
    references_bib = generator.render_references([reference.bibtex for reference in references])
    ok, pdf, log, errors = PDFCompiler().compile(latex_source, references_bib)
    
    # Enrich errors with section IDs and suggested fixes
    from app.services.ai_content import AIContentService
    ai_service = AIContentService()
    enriched_errors = []
    for err in errors:
        if err["line"] in line_map:
            err["section_id"] = line_map[err["line"]]
        
        if not ok and err.get("source_fragment"):
            err["suggested_fix"] = ai_service.suggest_fix(err["message"], err["source_fragment"])
        
        enriched_errors.append(err)

    report.compile_log = log
    report.status = "compiled" if ok else "compile_failed"
    if ok and pdf:
        report.pdf_storage_key = StorageService().put_bytes(pdf, "report.pdf", "application/pdf")
    report.quality_feedback = QualityAnalyzer().score(latex_source, [r.__dict__ for r in references])
    report.quality_score = report.quality_feedback["overall"]
    db.commit()
    db.refresh(report)
    return CompileResult(
        ok=ok,
        log=log,
        pdf_storage_key=report.pdf_storage_key,
        errors=[LaTeXError(**err) for err in enriched_errors],
    )


@router.post("/{report_id}/fix")
def apply_latex_fix(
    report_id: UUID,
    payload: LaTeXFixRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    report = db.get(Report, report_id)
    if not report:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Report not found")

    get_owned_project(report.project_id, user, db)

    content = db.get(GeneratedContent, payload.section_id)
    if not content:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Section content not found")

    if payload.old_fragment in content.content:
        content.content = content.content.replace(payload.old_fragment, payload.new_fragment)
        db.commit()
        return {"ok": True}

    from fastapi import HTTPException
    raise HTTPException(status_code=400, detail="Fragment not found in content")
