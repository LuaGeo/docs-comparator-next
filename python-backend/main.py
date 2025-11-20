from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import tempfile
import os
from hybrid_extractor import HybridPDFExtractor
from google.cloud import vision
import json

app = FastAPI(title="PDF Comparator API")

# CORS para permitir requisições do Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Ajuste conforme necessário
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar o extrator
vision_client = vision.ImageAnnotatorClient()
extractor = HybridPDFExtractor(vision_client=vision_client)


@app.get("/")
def read_root():
    return {
        "message": "PDF Comparator API",
        "version": "1.0.0",
        "endpoints": {
            "/extract": "POST - Extract text from a single PDF",
            "/compare": "POST - Compare two PDFs and return differences",
        }
    }


@app.post("/api/extract")
async def extract_pdf(file: UploadFile = File(...)):
    """
    Extrai texto de um único PDF usando o método híbrido (texto direto + OCR)
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Salvar arquivo temporariamente
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        content = await file.read()
        tmp_file.write(content)
        tmp_path = tmp_file.name
    
    try:
        # Extrair texto usando o método híbrido
        full_text, page_results, stats = extractor.extract_from_pdf(tmp_path)
        
        return JSONResponse(content={
            "success": True,
            "filename": file.filename,
            "text": full_text,
            "pages": page_results,
            "stats": stats
        })
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")
    
    finally:
        # Limpar arquivo temporário
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/api/compare")
async def compare_pdfs(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...)
):
    """
    Compara dois PDFs e retorna:
    - Texto extraído de cada um
    - Metadados (páginas processadas, métodos usados)
    - Estatísticas de processamento
    """
    if not file1.filename.endswith('.pdf') or not file2.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Salvar ambos os arquivos temporariamente
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp1:
        content1 = await file1.read()
        tmp1.write(content1)
        tmp1_path = tmp1.name
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp2:
        content2 = await file2.read()
        tmp2.write(content2)
        tmp2_path = tmp2.name
    
    try:
        # Extrair texto de ambos os PDFs
        print(f"🔍 Extracting text from {file1.filename}...")
        text1, pages1, stats1 = extractor.extract_from_pdf(tmp1_path)
        
        print(f"🔍 Extracting text from {file2.filename}...")
        text2, pages2, stats2 = extractor.extract_from_pdf(tmp2_path)
        
        return JSONResponse(content={
            "success": True,
            "file1": {
                "filename": file1.filename,
                "text": text1,
                "pages": pages1,
                "stats": stats1
            },
            "file2": {
                "filename": file2.filename,
                "text": text2,
                "pages": pages2,
                "stats": stats2
            }
        })
    
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error comparing PDFs: {str(e)}"
        )
    
    finally:
        # Limpar arquivos temporários
        if os.path.exists(tmp1_path):
            os.unlink(tmp1_path)
        if os.path.exists(tmp2_path):
            os.unlink(tmp2_path)


@app.get("/health")
def health_check():
    """Verificar se a API está funcionando"""
    return {"status": "healthy", "service": "pdf-comparator-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)