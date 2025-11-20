"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import * as diff from "diff";
import {
  Download,
  Loader2,
  AlertCircle,
  CheckCircle,
  FileText,
} from "lucide-react";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface UploadedFile {
  file: File;
  url: string;
  name: string;
}

interface DiffProcessorProps {
  file1: UploadedFile | null;
  file2: UploadedFile | null;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

interface ExtractionResult {
  filename: string;
  text: string;
  pages: any[];
  stats: {
    total_pages: number;
    text_extracted: number;
    ocr_used: number;
    hybrid: number;
    empty: number;
  };
}

interface DiffLine {
  lineNumber1: number;
  lineNumber2: number;
  text1: string;
  text2: string;
  type: "unchanged" | "modified" | "added" | "removed";
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DiffProcessor: React.FC<DiffProcessorProps> = ({
  file1,
  file2,
  onComplete,
  onError,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [diffPdfUrl, setDiffPdfUrl] = useState<string | null>(null);
  const [annotatedPdfUrl, setAnnotatedPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractionStats, setExtractionStats] = useState<{
    file1?: ExtractionResult["stats"];
    file2?: ExtractionResult["stats"];
  }>({});
  const [processingStep, setProcessingStep] = useState<string>("");
  const [extractedTexts, setExtractedTexts] = useState<{
    text1: string;
    text2: string;
  } | null>(null);

  const extractTextViaAPI = async (
    file1: File,
    file2: File
  ): Promise<{ text1: string; text2: string; stats1: any; stats2: any }> => {
    setProcessingStep("📤 Envoi des PDFs vers le serveur...");

    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);

    try {
      const response = await fetch(`${API_URL}/api/compare`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.detail || "Erreur lors de l'extraction du texte"
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error("L'API a retourné une erreur");
      }

      setExtractionStats({
        file1: data.file1.stats,
        file2: data.file2.stats,
      });

      return {
        text1: data.file1.text,
        text2: data.file2.text,
        stats1: data.file1.stats,
        stats2: data.file2.stats,
      };
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Erreur API: ${err.message}`);
      }
      throw new Error("Erreur de connexion à l'API");
    }
  };

  const extractTextLocalFallback = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ");
        fullText += pageText + "\n\n";
      }

      return fullText;
    } catch (err) {
      throw new Error("Erreur lors de l'extraction locale du texte");
    }
  };

  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const highlightWordDifferences = (
    text1: string,
    text2: string
  ): { html1: string; html2: string } => {
    const wordDiffs = diff.diffWords(text1, text2);
    let html1 = "";
    let html2 = "";

    for (const part of wordDiffs) {
      const escapedValue = escapeHtml(part.value);

      if (part.removed) {
        html1 += `<span class="removed-word">${escapedValue}</span>`;
      } else if (part.added) {
        html2 += `<span class="added-word">${escapedValue}</span>`;
      } else {
        html1 += escapedValue;
        html2 += escapedValue;
      }
    }

    return { html1, html2 };
  };

  const createLineDiff = (text1: string, text2: string): DiffLine[] => {
    const differences = diff.diffLines(text1, text2);
    const result: DiffLine[] = [];
    let index1 = 0;
    let index2 = 0;

    for (const part of differences) {
      const lines = part.value.split("\n");

      if (!part.added && !part.removed) {
        for (let i = 0; i < lines.length; i++) {
          if (i === lines.length - 1 && !lines[i]) continue;
          result.push({
            lineNumber1: index1 + 1,
            lineNumber2: index2 + 1,
            text1: lines[i],
            text2: lines[i],
            type: "unchanged",
          });
          index1++;
          index2++;
        }
      } else if (part.removed) {
        for (let i = 0; i < lines.length; i++) {
          if (i === lines.length - 1 && !lines[i]) continue;
          result.push({
            lineNumber1: index1 + 1,
            lineNumber2: -1,
            text1: lines[i],
            text2: "",
            type: "removed",
          });
          index1++;
        }
      } else if (part.added) {
        for (let i = 0; i < lines.length; i++) {
          if (i === lines.length - 1 && !lines[i]) continue;
          result.push({
            lineNumber1: -1,
            lineNumber2: index2 + 1,
            text1: "",
            text2: lines[i],
            type: "added",
          });
          index2++;
        }
      }
    }

    return result;
  };

  const createHtmlDiff = (
    text1: string,
    text2: string,
    filename1: string,
    filename2: string
  ): string => {
    const lineDiffs = createLineDiff(text1, text2);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comparaison: ${escapeHtml(filename1)} vs ${escapeHtml(
      filename2
    )}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: 12px; background: #f5f5f5; padding: 20px; }
    .header { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header h1 { font-size: 24px; margin-bottom: 10px; color: #333; }
    .header .filenames { display: flex; gap: 20px; margin-top: 10px; }
    .header .filename { padding: 8px 12px; background: #f0f0f0; border-radius: 4px; font-size: 13px; }
    .legend { background: white; padding: 15px 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; gap: 20px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .legend-box { width: 20px; height: 20px; border-radius: 3px; }
    .comparison-container { display: flex; gap: 2px; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .document-panel { flex: 1; overflow-x: auto; }
    .document-header { background: #2c3e50; color: white; padding: 12px 15px; font-weight: bold; position: sticky; top: 0; z-index: 10; }
    .line { display: flex; min-height: 24px; border-bottom: 1px solid #e0e0e0; transition: background-color 0.2s; }
    .line:hover { background-color: #f8f9fa !important; }
    .line-number { width: 50px; padding: 4px 8px; text-align: right; background: #f8f9fa; color: #666; border-right: 1px solid #ddd; user-select: none; flex-shrink: 0; }
    .line-content { padding: 4px 12px; white-space: pre-wrap; word-break: break-word; flex: 1; }
    .unchanged { background: white; }
    .modified { background: #fff9e6; }
    .added { background: #e6ffe6; }
    .removed { background: #ffe6e6; }
    .removed-word { background: #ffcccc; text-decoration: line-through; padding: 2px 4px; border-radius: 3px; }
    .added-word { background: #ccffcc; font-weight: bold; padding: 2px 4px; border-radius: 3px; }
    .empty-line { color: #ccc; font-style: italic; }
    @media print { body { background: white; padding: 0; } .comparison-container { box-shadow: none; } }
    @media (max-width: 768px) { .comparison-container { flex-direction: column; } .document-panel { width: 100%; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>📄 Comparaison de Documents PDF</h1>
    <div class="filenames">
      <div class="filename">📌 Document 1: ${escapeHtml(filename1)}</div>
      <div class="filename">📌 Document 2: ${escapeHtml(filename2)}</div>
    </div>
  </div>
  <div class="legend">
    <div class="legend-item"><div class="legend-box" style="background: #ffe6e6;"></div><span>Texte supprimé</span></div>
    <div class="legend-item"><div class="legend-box" style="background: #e6ffe6;"></div><span>Texte ajouté</span></div>
    <div class="legend-item"><div class="legend-box" style="background: #fff9e6;"></div><span>Texte modifié</span></div>
    <div class="legend-item"><div class="legend-box" style="background: white; border: 1px solid #ddd;"></div><span>Identique</span></div>
  </div>
  <div class="comparison-container">
    <div class="document-panel">
      <div class="document-header">📄 ${escapeHtml(filename1)}</div>
      ${lineDiffs
        .map((line) => {
          const highlighted =
            line.type === "modified" && line.text1 && line.text2
              ? highlightWordDifferences(line.text1, line.text2)
              : {
                  html1: escapeHtml(line.text1),
                  html2: escapeHtml(line.text2),
                };
          return `<div class="line ${line.type}">
          <div class="line-number">${
            line.lineNumber1 > 0 ? line.lineNumber1 : ""
          }</div>
          <div class="line-content ${!line.text1 ? "empty-line" : ""}">${
            line.text1 ? highlighted.html1 : "(ligne supprimée)"
          }</div>
        </div>`;
        })
        .join("")}
    </div>
    <div class="document-panel">
      <div class="document-header">📄 ${escapeHtml(filename2)}</div>
      ${lineDiffs
        .map((line) => {
          const highlighted =
            line.type === "modified" && line.text1 && line.text2
              ? highlightWordDifferences(line.text1, line.text2)
              : {
                  html1: escapeHtml(line.text1),
                  html2: escapeHtml(line.text2),
                };
          return `<div class="line ${line.type}">
          <div class="line-number">${
            line.lineNumber2 > 0 ? line.lineNumber2 : ""
          }</div>
          <div class="line-content ${!line.text2 ? "empty-line" : ""}">${
            line.text2 ? highlighted.html2 : "(ligne ajoutée)"
          }</div>
        </div>`;
        })
        .join("")}
    </div>
  </div>
  <script>
    const panels = document.querySelectorAll('.document-panel');
    let isScrolling = false;
    panels.forEach((panel, index) => {
      panel.addEventListener('scroll', () => {
        if (!isScrolling) {
          isScrolling = true;
          const otherPanel = panels[1 - index];
          otherPanel.scrollTop = panel.scrollTop;
          setTimeout(() => { isScrolling = false; }, 50);
        }
      });
    });
  </script>
</body>
</html>`;
  };

  const downloadHtmlDiff = () => {
    if (!extractedTexts || !file1 || !file2) return;

    const htmlContent = createHtmlDiff(
      extractedTexts.text1,
      extractedTexts.text2,
      file1.name,
      file2.name
    );

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `comparaison_${file1.name.replace(
      ".pdf",
      ""
    )}_vs_${file2.name.replace(".pdf", "")}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sanitizeTextForWinAnsi = (s: string) =>
    s.replace(/[\u0080-\uFFFF]/g, (ch) => {
      if (ch === "➢") return "-";
      return "?";
    });

  const createDiffPdf = async (text1: string, text2: string): Promise<Blob> => {
    setProcessingStep("📝 Génération du PDF de différences...");

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]);

    const { width, height } = page.getSize();
    const fontSize = 12;
    const lineHeight = fontSize * 1.2;
    const margin = 50;
    const maxWidth = width - 2 * margin;

    const differences = diff.diffLines(text1, text2);

    let yPosition = height - margin;
    let currentPage = page;

    currentPage.drawText("Comparaison PDF - Différences", {
      x: margin,
      y: yPosition,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });
    yPosition -= 30;

    currentPage.drawText("Légende:", {
      x: margin,
      y: yPosition,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
    yPosition -= lineHeight;

    currentPage.drawText("• Texte supprimé (rouge)", {
      x: margin + 10,
      y: yPosition,
      size: 10,
      font,
      color: rgb(0.8, 0, 0),
    });
    yPosition -= lineHeight * 0.8;

    currentPage.drawText("• Texte ajouté (vert)", {
      x: margin + 10,
      y: yPosition,
      size: 10,
      font,
      color: rgb(0, 0.6, 0),
    });
    yPosition -= 30;

    for (const part of differences) {
      if (yPosition < margin + 50) {
        currentPage = pdfDoc.addPage([595, 842]);
        yPosition = height - margin;
      }

      const lines = part.value.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        if (!line.trim()) continue;

        const words = line.split(" ");
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine + (currentLine ? " " : "") + word;
          const textWidth = font.widthOfTextAtSize(
            sanitizeTextForWinAnsi(testLine),
            fontSize
          );

          if (textWidth > maxWidth && currentLine) {
            let color = rgb(0, 0, 0);
            if (part.removed) color = rgb(0.8, 0, 0);
            if (part.added) color = rgb(0, 0.6, 0);

            currentPage.drawText(sanitizeTextForWinAnsi(currentLine), {
              x: margin,
              y: yPosition,
              size: fontSize,
              font,
              color,
            });

            yPosition -= lineHeight;
            currentLine = word;

            if (yPosition < margin + 50) {
              currentPage = pdfDoc.addPage([595, 842]);
              yPosition = height - margin;
            }
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          let color = rgb(0, 0, 0);
          if (part.removed) color = rgb(0.8, 0, 0);
          if (part.added) color = rgb(0, 0.6, 0);

          currentPage.drawText(sanitizeTextForWinAnsi(currentLine), {
            x: margin,
            y: yPosition,
            size: fontSize,
            font,
            color,
          });

          yPosition -= lineHeight;
        }
      }
    }

    const pdfBytes: Uint8Array = await pdfDoc.save();
    return new Blob([pdfBytes], { type: "application/pdf" });
  };

  type Segment = { start: number; end: number; kind: "added" | "modified" };

  const computeAddedAndModifiedSegments = (
    t1: string,
    t2: string
  ): Segment[] => {
    const parts = diff.diffWords(t1, t2) as Array<{
      added?: boolean;
      removed?: boolean;
      value: string;
    }>;
    const segments: Segment[] = [];
    let pos2 = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.added) {
        const start = pos2;
        const end = pos2 + p.value.length;
        const prev = parts[i - 1];
        const next = parts[i + 1];
        const modified =
          (prev && prev.removed) || (next && next.removed) ? true : false;
        segments.push({ start, end, kind: modified ? "modified" : "added" });
        pos2 = end;
      } else if (p.removed) {
      } else {
        pos2 += p.value.length;
      }
    }
    return segments;
  };

  interface TextItemBox {
    start: number;
    end: number;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const collectSecondTextLayout = async (
    file: File
  ): Promise<{
    items: TextItemBox[];
    text: string;
    pageHeights: number[];
    pageWidths: number[];
  }> => {
    const original = await file.arrayBuffer();
    const bufForPdfJs = original.slice(0);
    const bufForPdfLib = original.slice(0);

    const pdf = await pdfjs.getDocument({ data: bufForPdfJs }).promise;
    const secondPdf = await PDFDocument.load(bufForPdfLib);

    const items: TextItemBox[] = [];
    let assembled = "";
    const pageHeights: number[] = [];
    const pageWidths: number[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const pageIndex = i - 1;
      const { width, height } = secondPdf.getPage(pageIndex).getSize();
      pageWidths.push(width);
      pageHeights.push(height);

      const textContent = await page.getTextContent();
      const raw = textContent.items as any[];

      const viewport = page.getViewport({ scale: 1 });
      const rx = width / viewport.width;
      const ry = height / viewport.height;

      if (raw && raw.length > 0) {
        for (const it of raw) {
          const str: string = it.str || "";
          const start = assembled.length;
          assembled += str + " ";
          const end = assembled.length;

          const transform = it.transform;
          const tx = transform ? transform[4] : 0;
          const ty = transform ? transform[5] : 0;
          const hCanvas = transform
            ? Math.abs(transform[3] || 0)
            : it.height || 10;
          const wCanvas =
            typeof it.width === "number"
              ? it.width
              : Math.abs(transform ? transform[0] || 0 : 0);

          const xPt = tx * rx;
          const yTopPt = ty * ry;
          const hPt = hCanvas * ry;
          const wPt = Math.max(1, wCanvas * rx);

          const yBottomPt = Math.max(0, height - (yTopPt + hPt));

          items.push({
            start,
            end,
            pageIndex,
            x: xPt,
            y: yBottomPt,
            width: wPt,
            height: hPt,
          });
        }
      }

      assembled += "\n\n";
    }

    return { items, text: assembled, pageHeights, pageWidths };
  };

  const createAnnotatedSecondPdf = async (
    text1: string,
    text2: string,
    fileSecond: File
  ): Promise<Blob> => {
    setProcessingStep("🖍️ Annotation du PDF avec les différences...");

    const segments = computeAddedAndModifiedSegments(text1, text2);
    const layout = await collectSecondTextLayout(fileSecond);

    const inBytes = await fileSecond.arrayBuffer();
    const inDoc = await PDFDocument.load(inBytes);
    const outDoc = await PDFDocument.create();
    const srcPages = await outDoc.copyPages(inDoc, inDoc.getPageIndices());
    srcPages.forEach((p) => outDoc.addPage(p));

    for (const seg of segments) {
      const segStart = seg.start;
      const segEnd = seg.end;
      const color = seg.kind === "modified" ? rgb(1, 1, 0) : rgb(0.9, 0, 0);

      for (const it of layout.items) {
        const overlapStart = Math.max(segStart, it.start);
        const overlapEnd = Math.min(segEnd, it.end);
        if (overlapEnd <= overlapStart) continue;

        const fracStart =
          (overlapStart - it.start) / Math.max(1, it.end - it.start);
        const fracWidth =
          (overlapEnd - overlapStart) / Math.max(1, it.end - it.start);
        const rectX = it.x + it.width * fracStart;
        const rectW = it.width * fracWidth;
        const page = outDoc.getPage(it.pageIndex);
        const { height: pageH } = page.getSize();
        const rectYBottom = Math.max(0, pageH - (it.y + it.height));
        const rectH = Math.max(2, it.height * 1.1);
        page.drawRectangle({
          x: rectX,
          y: rectYBottom,
          width: rectW,
          height: rectH,
          color,
          opacity: 0.25,
          borderColor: color,
          borderOpacity: 0.25,
        });
      }
    }

    const outBytes: Uint8Array = await outDoc.save();
    return new Blob([outBytes], { type: "application/pdf" });
  };

  const processDiff = useCallback(async () => {
    if (!file1 || !file2) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStep("");

    try {
      let text1: string;
      let text2: string;

      try {
        setProcessingStep("🔗 Connexion à l'API Python...");
        const apiResult = await extractTextViaAPI(file1.file, file2.file);
        text1 = apiResult.text1;
        text2 = apiResult.text2;
        setProcessingStep("✅ Extraction hybride réussie (texte + OCR)");
      } catch (apiError) {
        console.warn(
          "API indisponible, utilisation du fallback local:",
          apiError
        );
        setProcessingStep(
          "⚠️ API indisponible, extraction locale (sans OCR)..."
        );
        text1 = await extractTextLocalFallback(file1.file);
        text2 = await extractTextLocalFallback(file2.file);
        setProcessingStep("✅ Extraction locale terminée");
      }

      // Salvar textos extraídos para HTML
      setExtractedTexts({ text1, text2 });

      const diffBlob = await createDiffPdf(text1, text2);
      const diffUrl = URL.createObjectURL(diffBlob);
      setDiffPdfUrl(diffUrl);

      const annotatedBlob = await createAnnotatedSecondPdf(
        text1,
        text2,
        file2.file
      );
      const annotatedUrl = URL.createObjectURL(annotatedBlob);
      setAnnotatedPdfUrl(annotatedUrl);

      setProcessingStep("✅ Traitement terminé avec succès!");
      if (onComplete) onComplete();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erreur lors du traitement";
      setError(message);
      setProcessingStep("");
      if (onError) onError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [file1, file2, onComplete, onError]);

  const downloadDiff = () => {
    if (!diffPdfUrl) return;
    const fileName = `differences_${file1?.name.replace(
      ".pdf",
      ""
    )}_vs_${file2?.name.replace(".pdf", "")}.pdf`;
    const link = document.createElement("a");
    link.href = diffPdfUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAnnotated = () => {
    if (!annotatedPdfUrl) return;
    const fileName = `annotated_${file2?.name}`;
    const link = document.createElement("a");
    link.href = annotatedPdfUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (file1 && file2) {
      processDiff();
    }
  }, [file1, file2, processDiff]);

  useEffect(() => {
    return () => {
      if (diffPdfUrl) URL.revokeObjectURL(diffPdfUrl);
      if (annotatedPdfUrl) URL.revokeObjectURL(annotatedPdfUrl);
    };
  }, [diffPdfUrl, annotatedPdfUrl]);

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center p-6 space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900 mb-2">
            Traitement en cours...
          </p>
          {processingStep && (
            <p className="text-sm text-gray-600">{processingStep}</p>
          )}
        </div>
        {extractionStats.file1 && (
          <div className="bg-blue-50 p-4 rounded-lg text-left w-full max-w-md space-y-2 text-sm">
            <p className="font-semibold text-blue-900">
              Statistiques d'extraction:
            </p>
            <div className="grid grid-cols-2 gap-2 text-gray-700">
              <div>📄 Pages totales: {extractionStats.file1.total_pages}</div>
              <div>📝 Texte direct: {extractionStats.file1.text_extracted}</div>
              <div>🔍 OCR utilisé: {extractionStats.file1.ocr_used}</div>
              <div>🔀 Hybride: {extractionStats.file1.hybrid}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center space-x-3 text-red-600 bg-red-50 p-4 rounded-lg">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (diffPdfUrl) {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-3 text-green-600 bg-green-50 p-4 rounded-lg">
          <CheckCircle className="w-6 h-6 flex-shrink-0" />
          <div>
            <p className="font-semibold">Comparaison terminée avec succès!</p>
            {extractionStats.file1 && (
              <p className="text-sm text-green-700 mt-1">
                {extractionStats.file1.ocr_used + extractionStats.file1.hybrid >
                0
                  ? `OCR utilisé sur ${
                      extractionStats.file1.ocr_used +
                      extractionStats.file1.hybrid
                    } page(s)`
                  : "Extraction de texte directe (rapide)"}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={downloadHtmlDiff}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 justify-center hover:scale-105 shadow-lg"
          >
            <FileText className="w-5 h-5" />
            <span>Télécharger la comparaison HTML (Recommandé)</span>
          </button>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={downloadDiff}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 justify-center hover:scale-105 shadow-lg flex-1"
            >
              <Download className="w-5 h-5" />
              <span>PDF de différences</span>
            </button>

            {annotatedPdfUrl && (
              <button
                onClick={downloadAnnotated}
                className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 justify-center hover:scale-105 shadow-lg flex-1"
              >
                <Download className="w-5 h-5" />
                <span>PDF annoté</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-600 text-center">
          💡 Le fichier HTML offre une meilleure visualisation côte à côte avec
          mise en évidence des différences
        </p>
      </div>
    );
  }

  return null;
};

export default DiffProcessor;
