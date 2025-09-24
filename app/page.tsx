"use client";

import React, { useState, useCallback } from "react";
import {
  Upload,
  FileText,
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import PdfUploader from "../components/PdfUploader";
import PdfPreview from "../components/PdfPreview";
import DiffProcessor from "../components/DiffProcessor";

interface UploadedFile {
  file: File;
  url: string;
  name: string;
}

type ProcessingStatus = "idle" | "processing" | "completed" | "error";

export default function Home() {
  const [file1, setFile1] = useState<UploadedFile | null>(null);
  const [file2, setFile2] = useState<UploadedFile | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = useCallback(
    (fileNumber: 1 | 2, file: File) => {
      const url = URL.createObjectURL(file);
      const uploadedFile: UploadedFile = {
        file,
        url,
        name: file.name,
      };

      if (fileNumber === 1) {
        if (file1?.url) URL.revokeObjectURL(file1.url);
        setFile1(uploadedFile);
      } else {
        if (file2?.url) URL.revokeObjectURL(file2.url);
        setFile2(uploadedFile);
      }

      setError(null);
    },
    [file1, file2]
  );

  const handleProcessDiff = useCallback(async () => {
    if (!file1 || !file2) return;

    setStatus("processing");
    setError(null);
  }, [file1, file2]);

  const canProcess = file1 && file2 && status !== "processing";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-blue-100 p-4 rounded-full">
              <FileText className="w-12 h-12 text-blue-600" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Comparateur PDF
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Comparez deux fichiers PDF et obtenez un fichier de différences avec
            les modifications en surbrillance. Les suppressions en rouge, les
            modifications en jaune.
          </p>
        </div>

        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <span className="bg-blue-500 text-white text-sm rounded-full w-6 h-6 flex items-center justify-center mr-3">
                1
              </span>
              Premier PDF
            </h2>
            <PdfUploader
              onFileUpload={(file) => handleFileUpload(1, file)}
              uploadedFile={file1}
              placeholder="Glissez votre premier PDF ici"
            />
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <span className="bg-blue-500 text-white text-sm rounded-full w-6 h-6 flex items-center justify-center mr-3">
                2
              </span>
              Second PDF
            </h2>
            <PdfUploader
              onFileUpload={(file) => handleFileUpload(2, file)}
              uploadedFile={file2}
              placeholder="Glissez votre second PDF ici"
            />
          </div>
        </div>

        {/* Preview Section */}
        {(file1 || file2) && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">
              Prévisualisation
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              <PdfPreview file={file1} title="Premier PDF" />
              <PdfPreview file={file2} title="Second PDF" />
            </div>
          </div>
        )}

        {/* Process Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={handleProcessDiff}
            disabled={!canProcess}
            className={`px-8 py-4 rounded-lg font-semibold text-white transition-all duration-200 flex items-center space-x-3 ${
              canProcess
                ? "bg-blue-600 hover:bg-blue-700 hover:scale-105 shadow-lg hover:shadow-xl"
                : "bg-gray-300 cursor-not-allowed"
            }`}
          >
            {status === "processing" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Traitement en cours...</span>
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                <span>Comparer les PDF</span>
              </>
            )}
          </button>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Processing and Diff */}
        {status === "processing" && file1 && file2 && (
          <div className="mb-8 p-6 bg-white border border-gray-200 rounded-lg">
            <DiffProcessor
              file1={file1}
              file2={file2}
              onComplete={() => setStatus("completed")}
              onError={(msg) => {
                setError(msg);
                setStatus("error");
              }}
            />
          </div>
        )}

        {status === "completed" && (
          <div className="mb-8 p-6 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center space-x-3 mb-4">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <h3 className="text-lg font-semibold text-green-800">
                Comparaison terminée
              </h3>
            </div>
            <p className="text-green-700 mb-4">
              Les différences ont été analysées et le fichier de comparaison est
              prêt au téléchargement.
            </p>
            <DiffProcessor file1={file1} file2={file2} />
          </div>
        )}

        {/* Info Section */}
        <div className="mt-16 bg-white rounded-xl p-8 shadow-sm">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Comment ça marche ?
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="bg-blue-100 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">1. Upload</h4>
              <p className="text-gray-600 text-sm">
                Glissez vos deux fichiers PDF dans les zones prévues
              </p>
            </div>
            <div className="text-center">
              <div className="bg-yellow-100 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                <FileText className="w-6 h-6 text-yellow-600" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">
                2. Comparaison
              </h4>
              <p className="text-gray-600 text-sm">
                L'algorithme analyse les différences entre les documents
              </p>
            </div>
            <div className="text-center">
              <div className="bg-green-100 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                <Download className="w-6 h-6 text-green-600" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">
                3. Téléchargement
              </h4>
              <p className="text-gray-600 text-sm">
                Récupérez votre PDF avec les différences surlignées
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
