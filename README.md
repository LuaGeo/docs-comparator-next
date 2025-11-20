# Docs Comparator Next

Application web de comparaison de documents PDF qui analyse les différences entre deux fichiers PDF et génère des rapports de comparaison en plusieurs formats.

## Fonctionnalités

- Upload et comparaison de deux documents PDF
- Extraction de texte avec support OCR (Google Cloud Vision)
- Prévisualisation PDF avec navigation par page
- Trois formats de sortie :
  - **HTML** : Vue côte à côte avec défilement synchronisé (recommandé)
  - **PDF Différences** : Liste textuelle des modifications
  - **PDF Annoté** : PDF original avec surlignages colorés
- Surlignage des différences :
  - Rouge : texte supprimé
  - Vert : texte ajouté
  - Jaune : texte modifié

## Technologies

**Frontend :**
- Next.js 15.5.4 / React 19 / TypeScript
- Tailwind CSS
- PDF.js (rendu et extraction)
- PDF-lib (manipulation PDF)

**Backend (optionnel) :**
- FastAPI (Python)
- PyMuPDF
- Google Cloud Vision (OCR)

## Installation

### 1. Frontend (Next.js)

```bash
# Installer les dépendances
npm install

# Copier le worker PDF.js
npm run copy-assets
```

### 2. Backend Python (optionnel - pour OCR avancé)

```bash
cd python-backend

# Créer l'environnement virtuel
python -m venv venv

# Activer l'environnement
# Windows :
venv\Scripts\activate
# macOS/Linux :
source venv/bin/activate

# Installer les dépendances
pip install -r requirements.txt
```

### 3. Configuration

Créer un fichier `.env` à la racine :

```env
GOOGLE_APPLICATION_CREDENTIALS=<chemin-vers-credentials-google-cloud>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

> **Note :** Le backend est optionnel. L'application fonctionne en mode client-side sans API, mais sans capacité OCR.

## Lancement

### Développement

**Terminal 1 - Frontend :**
```bash
npm run dev
# Accessible sur http://localhost:3000
```

**Terminal 2 - Backend (optionnel) :**
```bash
cd python-backend
# Activer venv
python main.py
# Accessible sur http://localhost:8000
```

### Production

```bash
npm run build
npm start
```

## Structure du projet

```
docs-comparator-next/
├── app/
│   ├── layout.tsx          # Layout principal
│   ├── page.tsx            # Page d'accueil
│   └── globals.css         # Styles globaux
├── components/
│   ├── DiffProcessor.tsx   # Logique de comparaison
│   ├── PdfUploader.tsx     # Upload de fichiers
│   └── PdfPreview.tsx      # Prévisualisation PDF
├── python-backend/
│   ├── main.py             # API FastAPI
│   ├── hybrid_extractor.py # Extraction hybride texte/OCR
│   └── requirements.txt    # Dépendances Python
├── public/                 # Assets statiques
└── package.json
```

## API Backend

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/` | GET | Info API |
| `/api/extract` | POST | Extraire texte d'un PDF |
| `/api/compare` | POST | Comparer deux PDFs |
| `/health` | GET | Health check |

### Exemple - Comparer deux PDFs

```bash
curl -X POST http://localhost:8000/api/compare \
  -F "file1=@document1.pdf" \
  -F "file2=@document2.pdf"
```

## Utilisation

1. Glisser-déposer ou sélectionner deux fichiers PDF (max 10 Mo chacun)
2. Vérifier les prévisualisations
3. Cliquer sur "Comparer les PDF"
4. Télécharger les résultats dans le format souhaité

## Scripts npm

| Script | Description |
|--------|-------------|
| `npm run dev` | Serveur de développement (Turbopack) |
| `npm run build` | Build de production |
| `npm start` | Serveur de production |
| `npm run lint` | Linter ESLint |
| `npm run copy-assets` | Copie le worker PDF.js |

## Limitations

- Format accepté : PDF uniquement
- Taille max par fichier : 10 Mo
- OCR nécessite le backend Python + credentials Google Cloud Vision

## Licence

Projet privé
