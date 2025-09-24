"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { pdfjs } from "react-pdf";
import * as diff from "diff";
import { Download, Loader2, AlertCircle } from "lucide-react";

// Configure PDF.js worker for Next.js with Turbopack
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
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

  const extractTextFromPdf = async (file: File): Promise<string> => {
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
      throw new Error("Erreur lors de l'extraction du texte du PDF");
    }
  };

  const createDiffPdf = async (text1: string, text2: string): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]); // A4 size

    const { width, height } = page.getSize();
    const fontSize = 12;
    const lineHeight = fontSize * 1.2;
    const margin = 50;
    const maxWidth = width - 2 * margin;

    // helper para evitar erro WinAnsi (caracteres fora de encoding)
    const sanitizeTextForWinAnsi = (s: string) =>
      s.replace(/[\u0080-\uFFFF]/g, (ch) => {
        if (ch === "➢") return "-";
        return "?";
      });

    // Calculate differences
    const differences = diff.diffLines(text1, text2);

    let yPosition = height - margin;
    let pageCount = 1;
    let currentPage = page;

    // Title
    currentPage.drawText("Comparaison PDF - Différences", {
      x: margin,
      y: yPosition,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });
    yPosition -= 30;

    // Legend
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

    // Process differences
    for (const part of differences) {
      if (yPosition < margin + 50) {
        // Create new page if needed
        currentPage = pdfDoc.addPage([595, 842]);
        yPosition = height - margin;
        pageCount++;
      }

      const lines = part.value.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        if (!line.trim()) continue;

        // Word wrap for long lines
        const words = line.split(" ");
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine + (currentLine ? " " : "") + word;
          const textWidth = font.widthOfTextAtSize(
            sanitizeTextForWinAnsi(testLine),
            fontSize
          );

          if (textWidth > maxWidth && currentLine) {
            // Draw current line
            let color = rgb(0, 0, 0); // default black
            if (part.removed) color = rgb(0.8, 0, 0); // red for removed
            if (part.added) color = rgb(0, 0.6, 0); // green for added

            currentPage.drawText(sanitizeTextForWinAnsi(currentLine), {
              x: margin,
              y: yPosition,
              size: fontSize,
              font,
              color,
            });

            yPosition -= lineHeight;
            currentLine = word;

            // Check if we need a new page
            if (yPosition < margin + 50) {
              currentPage = pdfDoc.addPage([595, 842]);
              yPosition = height - margin;
              pageCount++;
            }
          } else {
            currentLine = testLine;
          }
        }

        // Draw remaining text
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
        // removed text advances only in t1; do nothing to pos2
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
    y: number; // PDF.js y (top baseline)
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
    // Clona o buffer para cada lib evitar "detached ArrayBuffer"
    const bufForPdfJs = original.slice(0);
    const bufForPdfLib = original.slice(0);

    const pdf = await pdfjs.getDocument({ data: bufForPdfJs }).promise;
    const secondPdf = await PDFDocument.load(bufForPdfLib);

    const items: TextItemBox[] = [];
    let assembled = "";
    const pageHeights: number[] = [];
    const pageWidths: number[] = [];

    // Fallback de OCR quando não houver camada de texto - simplified for Next.js
    const ocrPageToItems = async (
      page: any,
      pageIndex: number,
      pointsWidth: number,
      pointsHeight: number
    ): Promise<{ items: TextItemBox[]; text: string }> => {
      // Simplified OCR fallback - in a real app you'd use Tesseract.js
      console.warn("OCR fallback needed but simplified for Next.js demo");
      return { items: [], text: "" };
    };

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const pageIndex = i - 1;
      const { width, height } = secondPdf.getPage(pageIndex).getSize();
      pageWidths.push(width);
      pageHeights.push(height);

      const textContent = await page.getTextContent();
      const raw = textContent.items as any[];

      // viewport para transformar coordenadas de canvas -> pontos
      const viewport = page.getViewport({ scale: 1 });
      const rx = width / viewport.width;
      const ry = height / viewport.height;

      if (raw && raw.length > 0) {
        for (const it of raw) {
          const str: string = it.str || "";
          const start = assembled.length;
          assembled += str + " ";
          const end = assembled.length;

          // aplica transform do viewport
          const t =
            (pdfjs as any).Util && (pdfjs as any).Util.transform
              ? (pdfjs as any).Util.transform(viewport.transform, it.transform)
              : it.transform;
          const tx = t ? t[4] : it.x || 0;
          const ty = t ? t[5] : it.y || 0;
          const hCanvas = t ? Math.abs(t[3] || 0) : it.height || 10;
          const wCanvas =
            typeof it.width === "number"
              ? it.width
              : Math.abs(t ? t[0] || 0 : 0);

          const xPt = tx * rx;
          const yTopPt = ty * ry;
          const hPt = hCanvas * ry;
          const wPt = Math.max(1, wCanvas * rx);

          // converte top-left (x, yTopPt) para bottom-left (x, yBottom)
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
      } else {
        // OCR fallback - simplified
        const { items: ocrItems, text } = await ocrPageToItems(
          page,
          pageIndex,
          width,
          height
        );
        for (const it of ocrItems) {
          items.push({
            ...it,
            y: Math.max(0, height - (it.y + it.height)),
          });
        }
        assembled += text;
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
    const segments = computeAddedAndModifiedSegments(text1, text2);
    // layout and a copy of the second PDF pages
    const layout = await collectSecondTextLayout(fileSecond);

    // Create output doc by loading original second and copying pages to a new doc to keep it identical
    const inBytes = await fileSecond.arrayBuffer();
    const inDoc = await PDFDocument.load(inBytes);
    const outDoc = await PDFDocument.create();
    const srcPages = await outDoc.copyPages(inDoc, inDoc.getPageIndices());
    srcPages.forEach((p) => outDoc.addPage(p));

    // Build highlights per segment by intersecting with text items
    for (const seg of segments) {
      const segStart = seg.start;
      const segEnd = seg.end;
      const color = seg.kind === "modified" ? rgb(1, 1, 0) : rgb(0.9, 0, 0);
      // find items overlapping
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

    try {
      // Extract text from both PDFs
      const text1 = await extractTextFromPdf(file1.file);
      const text2 = await extractTextFromPdf(file2.file);

      // Create diff PDF
      const diffBlob = await createDiffPdf(text1, text2);
      const diffUrl = URL.createObjectURL(diffBlob);
      setDiffPdfUrl(diffUrl);

      // Create annotated copy of the second PDF
      const annotatedBlob = await createAnnotatedSecondPdf(
        text1,
        text2,
        file2.file
      );
      const annotatedUrl = URL.createObjectURL(annotatedBlob);
      setAnnotatedPdfUrl(annotatedUrl);
      if (onComplete) onComplete();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erreur lors du traitement";
      setError(message);
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

    // Create download link
    const link = document.createElement("a");
    link.href = diffPdfUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAnnotated = () => {
    if (!annotatedPdfUrl) return;
    const fileName = `annotated_${file2?.name.replace(".pdf", "")}.pdf`;
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
      if (diffPdfUrl) {
        URL.revokeObjectURL(diffPdfUrl);
      }
      if (annotatedPdfUrl) {
        URL.revokeObjectURL(annotatedPdfUrl);
      }
    };
  }, [diffPdfUrl, annotatedPdfUrl]);

  if (isProcessing) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Analyse des différences en cours...</p>
        </div>
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
      <div className="text-center">
        <button
          onClick={downloadDiff}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 mx-auto hover:scale-105 shadow-lg"
        >
          <Download className="w-5 h-5" />
          <span>Télécharger le fichier de différences</span>
        </button>
        {annotatedPdfUrl && (
          <div className="mt-4">
            <button
              onClick={downloadAnnotated}
              className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 mx-auto hover:scale-105 shadow-lg"
            >
              <Download className="w-5 h-5" />
              <span>Télécharger le PDF annoté (copie du 2ᵉ)</span>
            </button>
          </div>
        )}
        <p className="text-sm text-gray-600 mt-3">
          Le fichier PDF contient les différences entre vos documents avec la
          légende colorée
        </p>
      </div>
    );
  }

  return null;
};

export default DiffProcessor;
