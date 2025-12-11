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

interface Stats {
  total_pages: number;
  text_extracted: number;
  ocr_used: number;
  hybrid: number;
  empty: number;
}

interface CompareHtmlResponse {
  success: boolean;
  html: string;
  is_identical: boolean;
  text1: string; // Texte nettoyé du fichier 1
  text2: string; // Texte nettoyé du fichier 2
  stats: {
    file1: Stats;
    file2: Stats;
    total_pages: number;
    total_ocr_pages: number;
    estimated_cost: string;
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DiffProcessor: React.FC<DiffProcessorProps> = ({
  file1,
  file2,
  onComplete,
  onError,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState<string>("");

  // Résultats
  const [htmlDiff, setHtmlDiff] = useState<string | null>(null);
  const [isIdentical, setIsIdentical] = useState<boolean>(false);
  const [stats, setStats] = useState<CompareHtmlResponse["stats"] | null>(null);
  const [annotatedPdfUrl, setAnnotatedPdfUrl] = useState<string | null>(null);

  /**
   * Appelle le nouvel endpoint /api/compare-html qui retourne le HTML
   * généré par difflib.HtmlDiff (identique à Streamlit)
   */
  const compareViaAPI = async (
    file1: File,
    file2: File
  ): Promise<CompareHtmlResponse> => {
    setProcessingStep("📤 Envoi des PDFs vers le serveur...");

    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);

    const response = await fetch(`${API_URL}/api/compare-html`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Erreur lors de la comparaison");
    }

    const data: CompareHtmlResponse = await response.json();

    if (!data.success) {
      throw new Error("L'API a retourné une erreur");
    }

    return data;
  };

  /**
   * Fallback : extraction locale avec PDF.js (sans OCR)
   */
  const extractTextLocalFallback = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      fullText += pageText + "\n\n";
    }

    return fullText;
  };

  /**
   * Crée un diff HTML local (fallback si API indisponible)
   */
  const createLocalHtmlDiff = (
    text1: string,
    text2: string,
    filename1: string,
    filename2: string
  ): string => {
    // Version simplifiée - moins bonne que difflib mais fonctionnelle
    const lines1 = text1.split("\n");
    const lines2 = text2.split("\n");

    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Comparaison (mode local)</title>
  <style>
    body { font-family: monospace; font-size: 12px; }
    .added { background: #e6ffe6; }
    .removed { background: #ffe6e6; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 8px; border: 1px solid #ddd; vertical-align: top; }
    .line-num { width: 40px; text-align: right; color: #666; }
  </style>
</head>
<body>
  <h2>⚠️ Mode local (API indisponible) - Comparaison basique</h2>
  <table>
    <tr><th colspan="2">${filename1}</th><th colspan="2">${filename2}</th></tr>`;

    const maxLines = Math.max(lines1.length, lines2.length);
    for (let i = 0; i < maxLines; i++) {
      const l1 = lines1[i] || "";
      const l2 = lines2[i] || "";
      const isDiff = l1 !== l2;
      const class1 = isDiff && l1 ? "removed" : "";
      const class2 = isDiff && l2 ? "added" : "";

      html += `<tr>
        <td class="line-num">${l1 ? i + 1 : ""}</td>
        <td class="${class1}">${l1}</td>
        <td class="line-num">${l2 ? i + 1 : ""}</td>
        <td class="${class2}">${l2}</td>
      </tr>`;
    }

    html += `</table></body></html>`;
    return html;
  };

  /**
   * Télécharge le HTML diff
   */
  const downloadHtmlDiff = () => {
    if (!htmlDiff || !file1 || !file2) return;

    const blob = new Blob([htmlDiff], { type: "text/html;charset=utf-8" });
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

  /**
   * Crée le PDF annoté (conservé de l'ancienne version)
   */
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
        // skip
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

  /**
   * Process principal
   */
  const processDiff = useCallback(async () => {
    if (!file1 || !file2) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStep("");
    setHtmlDiff(null);
    setAnnotatedPdfUrl(null);

    try {
      let resultHtml: string;
      let text1ForAnnotation: string;
      let text2ForAnnotation: string;

      try {
        // Essayer l'API Python (recommandé)
        setProcessingStep("🔗 Connexion à l'API Python...");
        const apiResult = await compareViaAPI(file1.file, file2.file);
        console.log("=== TEXT1 (premiers 500 chars) ===");
        console.log(apiResult.text1.substring(0, 500));
        console.log("=== TEXT2 (premiers 500 chars) ===");
        console.log(apiResult.text2.substring(0, 500));

        resultHtml = apiResult.html;
        setIsIdentical(apiResult.is_identical);
        setStats(apiResult.stats);
        setProcessingStep("✅ Comparaison HTML générée par l'API");

        // Utiliser les textes nettoyés de l'API pour le PDF annoté
        text1ForAnnotation = apiResult.text1;
        text2ForAnnotation = apiResult.text2;
      } catch (apiError) {
        // Fallback local
        console.warn(
          "API indisponible, utilisation du fallback local:",
          apiError
        );
        setProcessingStep(
          "⚠️ API indisponible, extraction locale (sans OCR)..."
        );

        text1ForAnnotation = await extractTextLocalFallback(file1.file);
        text2ForAnnotation = await extractTextLocalFallback(file2.file);

        resultHtml = createLocalHtmlDiff(
          text1ForAnnotation,
          text2ForAnnotation,
          file1.name,
          file2.name
        );

        setIsIdentical(text1ForAnnotation.trim() === text2ForAnnotation.trim());
        setProcessingStep("✅ Extraction locale terminée");
      }

      setHtmlDiff(resultHtml);

      // Créer le PDF annoté
      const annotatedBlob = await createAnnotatedSecondPdf(
        text1ForAnnotation,
        text2ForAnnotation,
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

  useEffect(() => {
    if (file1 && file2) {
      processDiff();
    }
  }, [file1, file2, processDiff]);

  useEffect(() => {
    return () => {
      if (annotatedPdfUrl) URL.revokeObjectURL(annotatedPdfUrl);
    };
  }, [annotatedPdfUrl]);

  // --- RENDER ---

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
        {stats?.file1 && (
          <div className="bg-blue-50 p-4 rounded-lg text-left w-full max-w-md space-y-2 text-sm">
            <p className="font-semibold text-blue-900">
              Statistiques d'extraction:
            </p>
            <div className="grid grid-cols-2 gap-2 text-gray-700">
              <div>📄 Pages totales: {stats.total_pages}</div>
              <div>🔍 OCR utilisé: {stats.total_ocr_pages} pages</div>
              <div>💰 Coût estimé: {stats.estimated_cost}</div>
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

  if (htmlDiff) {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-3 text-green-600 bg-green-50 p-4 rounded-lg">
          <CheckCircle className="w-6 h-6 flex-shrink-0" />
          <div>
            <p className="font-semibold">
              {isIdentical
                ? "🎉 Les deux documents ont un contenu textuel identique !"
                : "Comparaison terminée avec succès!"}
            </p>
            {stats && (
              <p className="text-sm text-green-700 mt-1">
                {stats.total_ocr_pages > 0
                  ? `OCR utilisé sur ${stats.total_ocr_pages} page(s) - Coût: ${stats.estimated_cost}`
                  : "Extraction de texte directe (rapide et gratuit)"}
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

          {annotatedPdfUrl && (
            <button
              onClick={downloadAnnotated}
              className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-3 justify-center hover:scale-105 shadow-lg"
            >
              <Download className="w-5 h-5" />
              <span>Télécharger le PDF annoté</span>
            </button>
          )}
        </div>

        <p className="text-sm text-gray-600 text-center">
          💡 Le fichier HTML utilise le même format que l'application Streamlit
        </p>
      </div>
    );
  }

  return null;
};

export default DiffProcessor;
