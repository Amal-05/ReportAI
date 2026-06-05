from uuid import UUID

from pydantic import BaseModel, Field


class GenerateContentRequest(BaseModel):
    length: str = Field(default="standard", pattern="^(brief|standard|detailed)$")
    sections: list[str] | None = None


class GeneratedSectionRead(BaseModel):
    id: UUID
    section: str
    content: str
    meta: dict

    model_config = {"from_attributes": True}


class ResearchAssistRequest(BaseModel):
    selected_text: str | None = None
    full_source: str | None = None
    prompt: str


class ResearchAssistResponse(BaseModel):
    answer: str
    suggested_text: str | None = None
    action: str = "chat"  # "chat", "replace", "insert"
