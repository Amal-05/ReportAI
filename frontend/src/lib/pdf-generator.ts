import { jsPDF } from "jspdf";

type ParsedSection = { title: string; body: string };
type RenderBlock = { type: "paragraph"; text: string } | { type: "list-item"; text: string };

function extractCommandContent(source: string, command: string) {
  const start = source.indexOf(`\\${command}{`);
  if (start === -1) return "";

  const contentStart = start + command.length + 2;
  let depth = 1;

  for (let index = contentStart; index < source.length; index++) {
    const char = source[index];
    const previous = source[index - 1];

    if (char === "{" && previous !== "\\") depth++;
    if (char === "}" && previous !== "\\") depth--;
    if (depth === 0) return source.slice(contentStart, index);
  }

  return "";
}

function normalizeLatexText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(/```(?:latex)?|```/gi, "")
    .replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, "")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\textasciitilde\{\}|\\textasciitilde/g, "~")
    .replace(/\\textbackslash\{\}|\\textbackslash/g, "\\")
    .replace(/\\textbullet\b/g, "")
    .replace(/~+/g, " ")
    .replace(/``|''/g, "\"")
    .replace(/[–—]/g, "-")
    .replace(/--+/g, "-");
}

function stripLatexCommands(value: string) {
  let text = normalizeLatexText(value);

  text = text
    .replace(/\\cite(?:\[[^\]]*\])?\{[^}]*\}/g, "[Ref]")
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{[^}]*\}/g, "[Diagram]")
    .replace(/\\(?:label|ref|pageref|bibliographystyle|bibliography)\{[^}]*\}/g, "")
    .replace(/\\(?:begin|end)\{[^}]+\}(?:\[[^\]]*\])?/g, "")
    .replace(/\blstlisting(?:\[[^\]]*\])?/gi, "")
    .replace(/\[[^\]]*(?:label|leftmargin|language|caption)\s*=[^\]]*\]\s*/gi, "")
    .replace(/\\(?:onehalfspacing|maketitle|tableofcontents|clearpage|newpage|noindent|centering)\b/g, "")
    .replace(/\\(?:textbf|textit|texttt|emph|underline|url)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:textbf|textit|texttt|emph|underline|url)\{?/g, "")
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:chapter|section|subsection|subsubsection)\*?\{([^{}]*)\}/g, "$1")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function parseBlocks(value: string): RenderBlock[] {
  const itemMarker = "__REPORTAI_LIST_ITEM__";
  const prepared = normalizeLatexText(value)
    .replace(/\\begin\{(?:itemize|enumerate)\}(?:\[[^\]]*\])?|\\end\{(?:itemize|enumerate)\}/g, "\n")
    .replace(/\\begin\{(?:lstlisting|verbatim|minted)\}(?:\[[^\]]*\])?|\\end\{(?:lstlisting|verbatim|minted)\}/g, "\n")
    .replace(/\[[^\]]*(?:label|leftmargin|language|caption)\s*=[^\]]*\]\s*/gi, "")
    .replace(/\\item(?:\[[^\]]*\])?/g, `\n${itemMarker} `)
    .replace(/(^|\s)(?:[*-]|\d+[.)])\s+(?=[A-Z0-9])/g, `\n${itemMarker} `)
    .replace(/\\\\|\\newline/g, "\n");

  const blocks: RenderBlock[] = [];
  let currentParagraph: string[] = [];
  let currentListItem: string[] | null = null;

  const flushParagraph = () => {
    const text = stripLatexCommands(currentParagraph.join(" "));
    if (text) blocks.push({ type: "paragraph", text });
    currentParagraph = [];
  };

  const flushListItem = () => {
    if (!currentListItem) return;
    const text = stripLatexCommands(currentListItem.join(" "));
    if (text) blocks.push({ type: "list-item", text });
    currentListItem = null;
  };

  prepared.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushListItem();
      flushParagraph();
      return;
    }

    const markdownListMatch = line.match(/^(?:[*-]|\d+[.)])\s+(.+)$/);

    if (line.startsWith(itemMarker) || markdownListMatch) {
      flushListItem();
      flushParagraph();
      currentListItem = [line.startsWith(itemMarker) ? line.slice(itemMarker.length).trim() : markdownListMatch?.[1] ?? ""];
      return;
    }

    if (currentListItem) {
      currentListItem.push(line);
      return;
    }

    currentParagraph.push(line);
  });

  flushListItem();
  flushParagraph();
  return blocks;
}

export function generateAndDownloadPdf(projectTitle: string, latex: string) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  // 1. Parse Title, Author, Chapters, and Sections
  const titleContent = extractCommandContent(latex, "title");
  const parsedTitle = stripLatexCommands(titleContent || projectTitle) || projectTitle;

  // Extract Chapters
  const chapterRegex = /\\chapter\*?\{([^}]+)\}([\s\S]*?)(?=\\chapter\*?\{|\s*\\bibliographystyle|\s*\\end\{document\})/g;
  const chapters: { title: string; content: string }[] = [];
  let match;
  while ((match = chapterRegex.exec(latex)) !== null) {
    chapters.push({
      title: stripLatexCommands(match[1]),
      content: match[2].trim(),
    });
  }

  // Fallback if regex doesn't match standard chapters
  if (chapters.length === 0) {
    chapters.push({
      title: "Project Report",
      content: latex
        .replace(/\\documentclass[\s\S]*?\\begin\{document\}/, "")
        .replace(/\\maketitle|\\tableofcontents/, "")
        .replace(/\\end\{document\}[\s\S]*/, "")
        .trim(),
    });
  }

  // 2. Render Elegant Cover Page (Page 1)
  doc.setFillColor(248, 250, 252); // Soft light blue-grey background tint
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Cover Page Borders
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(1);
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20, "D");
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24, "D");

  // Cover Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("ACADEMIC RESEARCH & REPORT DRAFT", pageWidth / 2, 45, { align: "center" });

  // Cover Main Title
  doc.setFont("times", "bold");
  doc.setFontSize(26);
  doc.setTextColor(15, 23, 42); // Very dark slate
  const wrappedTitle = doc.splitTextToSize(parsedTitle, pageWidth - 45);
  doc.text(wrappedTitle, pageWidth / 2, 75, { align: "center" });

  // Divider Line
  doc.setDrawColor(99, 102, 241); // Indigo divider line
  doc.setLineWidth(1.5);
  doc.line(pageWidth / 2 - 30, 115, pageWidth / 2 + 30, 115);

  // Cover Metadata
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text("Prepared by ReportAI Platform", pageWidth / 2, 135, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Date of Compilation: ${new Date().toLocaleDateString()}`, pageWidth / 2, 145, { align: "center" });

  // Institution watermark at bottom
  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text("CONFIDENTIAL - FOR ACADEMIC ASSESSMENTS ONLY", pageWidth / 2, 255, { align: "center" });

  // 3. Render Table of Contents (Page 2)
  doc.addPage();
  let currentPage = 2;
  
  // Header on Page 2
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text("Table of Contents", margin, 35);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, 40, pageWidth - margin, 40);

  let tocY = 55;
  chapters.forEach((ch, index) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(`Chapter ${index + 1}: ${ch.title}`, margin, tocY);
    
    // Dot Leaders
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    const labelWidth = doc.getTextWidth(`Chapter ${index + 1}: ${ch.title}`);
    const dotsStart = margin + labelWidth + 3;
    const dotsEnd = pageWidth - margin - 15;
    let dots = "";
    for (let d = 0; d < Math.floor((dotsEnd - dotsStart) / 1.5); d++) {
      dots += ".";
    }
    doc.text(dots, dotsStart, tocY);

    // Dynamic Page Estimates (Starting Cover + TOC is 2 pages)
    const pageNum = 3 + index; 
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(String(pageNum), pageWidth - margin, tocY, { align: "right" });
    tocY += 12;
  });

  // 4. Render Chapters
  chapters.forEach((ch, chIndex) => {
    doc.addPage();
    currentPage++;

    let y = 35;

    // Running Header
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("ReportAI Academic Research System", margin, 15);
    doc.text(parsedTitle, pageWidth - margin, 15, { align: "right" });
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.5);
    doc.line(margin, 18, pageWidth - margin, 18);

    // Chapter Title
    doc.setFont("times", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text(`Chapter ${chIndex + 1}: ${ch.title}`, margin, y);
    y += 10;

    // Subheader line
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(1.5);
    doc.line(margin, y - 5, margin + 40, y - 5);
    
    // Parse Sections within Chapter Content
    // A regex to match \section{Section Title}
    const sectionRegex = /\\section\*?\{([^}]+)\}([\s\S]*?)(?=\\section\*?\{|$)/g;
    const sections: ParsedSection[] = [];
    let secMatch;
    
    // Clean LaTeX syntax tags from chapter content
    let cleanContent = ch.content
      .replace(/\\onehalfspacing|\\maketitle|\\tableofcontents/g, "")
      .trim();

    // Extract any introductory text before the first section
    const firstSectionMatch = /\\section\*?\{/.exec(cleanContent);
    const firstSectionIndex = firstSectionMatch?.index ?? -1;
    if (firstSectionIndex > 0) {
      const introText = cleanContent.substring(0, firstSectionIndex).trim();
      if (introText) {
        sections.push({
          title: "Introduction",
          body: introText,
        });
      }
    }

    while ((secMatch = sectionRegex.exec(cleanContent)) !== null) {
      sections.push({
        title: stripLatexCommands(secMatch[1]),
        body: secMatch[2].trim(),
      });
    }

    if (sections.length === 0) {
      sections.push({
        title: "Introduction & Context",
        body: cleanContent,
      });
    }

    // Render Sections & Body Paragraphs
    sections.forEach((sec) => {
      // Check for page overflow before rendering section header
      if (y > pageHeight - 35) {
        doc.addPage();
        currentPage++;
        // Add running header on new page
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text("ReportAI Academic Research System", margin, 15);
        doc.text(parsedTitle, pageWidth - margin, 15, { align: "right" });
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.5);
        doc.line(margin, 18, pageWidth - margin, 18);
        y = 30;
      }

      // Render Section Header
      doc.setFont("times", "bold");
      doc.setFontSize(13);
      doc.setTextColor(30, 41, 59);
      doc.text(sec.title, margin, y);
      y += 8;

      doc.setFont("times", "normal");
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85);
      
      const blocks = parseBlocks(sec.body);
      blocks.forEach((block) => {
        const left = block.type === "list-item" ? margin + 7 : margin;
        const width = block.type === "list-item" ? contentWidth - 7 : contentWidth;
        const wrappedLines = doc.splitTextToSize(block.text, width);
        
        wrappedLines.forEach((line: string, lineIndex: number) => {
          if (y > pageHeight - 25) {
            doc.addPage();
            currentPage++;
            // Add running header on new page
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text("ReportAI Academic Research System", margin, 15);
            doc.text(parsedTitle, pageWidth - margin, 15, { align: "right" });
            doc.setDrawColor(241, 245, 249);
            doc.setLineWidth(0.5);
            doc.line(margin, 18, pageWidth - margin, 18);
            y = 30;
            doc.setFont("times", "normal");
            doc.setFontSize(11);
            doc.setTextColor(51, 65, 85);
          }
          if (block.type === "list-item" && lineIndex === 0) {
            doc.setFillColor(71, 85, 105);
            doc.circle(margin + 2, y - 1.4, 0.75, "F");
          }
          doc.text(line, left, y);
          y += 6.5; // Line spacing (1.5x equivalent)
        });
        
        y += block.type === "list-item" ? 2 : 4; // Spacing between blocks
      });

      y += 6; // Spacing after section
    });
  });

  // 5. Add Running Footers with Correct Page Numbers on all pages (excluding cover page)
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 12, { align: "right" });
    doc.text("CONFIDENTIAL - REPORTAI ACADEMIC DRAFT", margin, pageHeight - 12);
  }

  // 6. Save/Download the PDF File
  const filename = `${parsedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_report.pdf`;
  doc.save(filename);
}
