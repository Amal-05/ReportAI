import { jsPDF } from "jspdf";

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
  const titleMatch = latex.match(/\\title\{([\s\S]*?)\}/);
  const parsedTitle = titleMatch ? titleMatch[1].trim() : projectTitle;

  // Extract Chapters
  const chapterRegex = /\\chapter\{([^}]+)\}([\s\S]*?)(?=\\chapter|\s*\\bibliographystyle|\s*\\end\{document\})/g;
  const chapters: { title: string; content: string }[] = [];
  let match;
  while ((match = chapterRegex.exec(latex)) !== null) {
    chapters.push({
      title: match[1].trim(),
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
    const sectionRegex = /\\section\{([^}]+)\}([\s\S]*?)(?=\\section|$)/g;
    const sections: { title: string; body: string }[] = [];
    let secMatch;
    
    // Clean LaTeX syntax tags from chapter content
    let cleanContent = ch.content
      .replace(/\\begin\{itemize\}|\\end\{itemize\}|\\begin\{enumerate\}|\\end\{enumerate\}/g, "")
      .replace(/\\item/g, "  * ")
      .replace(/\\onehalfspacing|\\maketitle|\\tableofcontents/g, "")
      .replace(/\\\\|\\newline/g, "\n")
      .trim();

    // Extract any introductory text before the first section
    const firstSectionIndex = cleanContent.indexOf("\\section{");
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
        title: secMatch[1].trim(),
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

      // Clean the section body text from remaining LaTeX markers
      const cleanBody = sec.body
        .replace(/\\cite\{[^}]+\}/g, "[Ref]")
        .replace(/\\includegraphics[\s\S]*?(\}|$)/g, "[UML Architecture Diagram]")
        .replace(/\\label\{[^}]+\}/g, "")
        .replace(/\\ref\{[^}]+\}/g, "[Fig]")
        .replace(/\\bibliographystyle[\s\S]*/g, "")
        .replace(/\\bibliography[\s\S]*/g, "")
        .replace(/\\(textbf|textit|texttt|emph|url|href)\{([^}]+)\}/g, "$2") // clean common formatting commands
        .replace(/\\[a-zA-Z]+\{([^}]+)\}/g, "$1") // general clean of other commands
        .replace(/[\{\}]/g, "") // strip any stray braces
        .trim();

      // Split body into lines and wrap
      doc.setFont("times", "normal");
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85);
      
      const paragraphs = cleanBody.split("\n\n");
      paragraphs.forEach((p) => {
        const cleanParagraph = p.trim().replace(/\s+/g, " ");
        if (!cleanParagraph) return;

        const wrappedLines = doc.splitTextToSize(cleanParagraph, contentWidth);
        
        wrappedLines.forEach((line: string) => {
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
          doc.text(line, margin, y);
          y += 6.5; // Line spacing (1.5x equivalent)
        });
        
        y += 4; // Spacing between paragraphs
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
