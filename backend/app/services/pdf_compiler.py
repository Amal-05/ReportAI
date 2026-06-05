import subprocess
import tempfile
from pathlib import Path


import re

class PDFCompiler:
    def compile(self, latex_source: str, references_bib: str = "") -> tuple[bool, bytes | None, str, list[dict]]:
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            tex_path = workdir / "report.tex"
            tex_path.write_text(latex_source, encoding="utf-8")
            (workdir / "references.bib").write_text(references_bib, encoding="utf-8")
            result = subprocess.run(
                ["latexmk", "-pdf", "-interaction=nonstopmode", "report.tex"],
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            pdf_path = workdir / "report.pdf"
            log_content = (result.stdout + "\n" + result.stderr)[-8000:]
            errors = self.parse_errors(log_content, latex_source)
            
            if result.returncode == 0 and pdf_path.exists():
                return True, pdf_path.read_bytes(), log_content, errors
            return False, None, log_content, errors

    def parse_errors(self, log: str, source: str) -> list[dict]:
        errors = []
        # Match pattern like "! Undefined control sequence. \nl.42 \thisiswrong"
        # or "! LaTeX Error: ..."
        error_blocks = re.split(r'^!', log, flags=re.MULTILINE)
        source_lines = source.splitlines()

        for block in error_blocks[1:]:
            lines = block.splitlines()
            message = lines[0].strip()
            line_num = None
            context = ""
            
            for l in lines:
                m = re.search(r'^l\.(\d+)', l)
                if m:
                    line_num = int(m.group(1))
                    context = l.strip()
                    break
            
            if line_num and 1 <= line_num <= len(source_lines):
                actual_line_content = source_lines[line_num - 1]
                errors.append({
                    "line": line_num,
                    "message": message,
                    "context": context,
                    "source_fragment": actual_line_content
                })
            else:
                errors.append({
                    "line": None,
                    "message": message,
                    "context": block[:200].strip(),
                    "source_fragment": None
                })
        
        return errors[:5] # Limit to first 5 errors
