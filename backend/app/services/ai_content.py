from openai import OpenAI

from app.core.config import settings


DEFAULT_SECTIONS = [
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


class AIContentService:
    def __init__(self) -> None:
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI | None:
        if not settings.openai_api_key:
            return None
        if self._client is None:
            self._client = OpenAI(api_key=settings.openai_api_key)
        return self._client

    def generate_sections(
        self,
        project: dict,
        template: dict | None,
        answers: dict,
        sections: list[str] | None,
        length: str,
    ) -> list[dict]:
        target_sections = sections or (template or {}).get("chapters") or DEFAULT_SECTIONS
        if self.client is None:
            return [self._fallback_section(section, project, answers, length) for section in target_sections]

        prompt = {
            "project": project,
            "template": template,
            "answers": answers,
            "sections": target_sections,
            "length": length,
            "requirements": [
                "academic tone",
                "plagiarism-safe original writing",
                "professional language",
                "proper report hierarchy",
            ],
        }
        response = self.client.responses.create(
            model=settings.openai_model,
            input=f"Generate academic report sections as JSON array: {prompt}",
        )
        return [{"section": "Generated Draft", "content": response.output_text, "meta": {"model": settings.openai_model}}]

    def _fallback_section(self, section: str, project: dict, answers: dict, length: str) -> dict:
        content = (
            f"\\section{{{section}}}\n"
            f"This {length} draft section describes {project['title']} in the context of "
            f"{project['domain']}. It should be expanded with university-specific evidence, "
            f"implementation details, results, and citations. Key submitted project details: {answers}."
        )
        return {"section": section, "content": content, "meta": {"mode": "offline-fallback"}}

    def suggest_fix(self, error_message: str, source_fragment: str) -> str | None:
        if self.client is None:
            # Basic heuristic fix for common errors
            if "_" in source_fragment and r"\_" not in source_fragment:
                return source_fragment.replace("_", r"\_")
            if "%" in source_fragment and r"\%" not in source_fragment:
                return source_fragment.replace("%", r"\%")
            return None

        prompt = f"""
        Fix this LaTeX error: {error_message}
        Problematic line: {source_fragment}
        
        Return ONLY the corrected line. No explanation.
        """
        try:
            response = self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
            )
            return response.choices[0].message.content.strip()
        except Exception:
            return None
