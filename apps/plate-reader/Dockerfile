FROM python:3.12-slim

# Tesseract + libs de runtime do OpenCV. Ao contrário do OpenALPR (projeto
# estagnado, sem binding Python mantido e build só validado em Ubuntu 18.04),
# tesseract-ocr é empacotado normalmente para Debian/Ubuntu atuais.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
