from app.core.ai_utils import get_openai_client_and_model


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
    def generate_sections(
        self,
        project: dict,
        template: dict | None,
        answers: dict,
        sections: list[str] | None,
        length: str,
    ) -> list[dict]:
        target_sections = sections or (template or {}).get("chapters") or DEFAULT_SECTIONS
        
        try:
            client, model = get_openai_client_and_model()
        except ValueError:
            return [self._fallback_section(section, project, answers, length) for section in target_sections]

        prompt = f"""You are a professional academic writer. Generate highly detailed academic content for the following report sections:
{", ".join(target_sections)}

Project Context:
Title: {project['title']}
Domain: {project['domain']}
Description: {project.get('description', '')}

Student Answers:
{answers}

Guidelines:
- Length: {length}
- Tone: Academic, formal, technical
- Format: LaTeX compatible
- Citations: Include placeholder citations like [1], [2] where appropriate.

Return a JSON array of objects, where each object has:
"section": "The section name"
"content": "The generated LaTeX content"

Return ONLY the JSON array."""

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are an academic report writing assistant. You must return only a valid JSON array of section objects."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"} if "gemini" not in model.lower() else None
            )
            import json
            content = response.choices[0].message.content.strip()
            # If it's a json_object but we asked for an array, it might wrap it in a key or return just the array if supported.
            # Actually OpenAI's json_object requires the word 'json' in prompt and usually returns an object.
            # I'll try to parse it as an array or look for a key.
            parsed = json.loads(content)
            if isinstance(parsed, dict) and "sections" in parsed:
                return parsed["sections"]
            if isinstance(parsed, list):
                return parsed
            return [{"section": "Generated Draft", "content": content, "meta": {"model": model}}]
        except Exception as e:
            print(f"Error generating AI sections: {e}")
            return [self._fallback_section(section, project, answers, length) for section in target_sections]

    def research_assist(self, prompt: str, selected_text: str | None, full_source: str | None) -> dict:
        try:
            client, model = get_openai_client_and_model()
        except ValueError:
            return {
                "answer": "AI assistance is currently offline. Please configure your API key.",
                "suggested_text": None,
                "action": "chat"
            }

        context_text = f"\nSelected Text:\n{selected_text}" if selected_text else ""
        if not selected_text and full_source:
            context_text = f"\nFull Document Context (partial):\n{full_source[:2000]}"

        system_prompt = """You are an expert academic research assistant and LaTeX specialist. 
Your goal is to help students refine their project reports.
You must return a JSON object with:
- "answer": A brief, helpful explanation of what you did or suggested.
- "suggested_text": The modified LaTeX code or new content (if any).
- "action": One of ["chat", "replace", "insert"]. Use "replace" if you modified the selected text, "insert" if you generated something new to be added, and "chat" for general advice."""

        user_prompt = f"User Request: {prompt}{context_text}\n\nReturn only JSON."

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"} if "gemini" not in model.lower() else None
            )
            import json
            return json.loads(response.choices[0].message.content.strip())
        except Exception as e:
            print(f"Error in research_assist: {e}")
            return {
                "answer": f"Sorry, I encountered an error: {str(e)}",
                "suggested_text": None,
                "action": "chat"
            }

    def _fallback_section(self, section: str, project: dict, answers: dict, length: str) -> dict:
        content = (
            f"\\section{{{section}}}\n"
            f"This {length} draft section describes {project['title']} in the context of "
            f"{project['domain']}. It should be expanded with university-specific evidence, "
            f"implementation details, results, and citations. Key submitted project details: {answers}."
        )
        return {"section": section, "content": content, "meta": {"mode": "offline-fallback"}}

    def suggest_fix(self, error_message: str, source_fragment: str) -> str | None:
        try:
            client, model = get_openai_client_and_model()
        except ValueError:
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
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
            )
            return response.choices[0].message.content.strip()
        except Exception:
            return None
