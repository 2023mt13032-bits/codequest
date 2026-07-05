FROM python:3.11-slim
RUN pip install --no-cache-dir fastapi==0.115.6 uvicorn==0.34.0
RUN useradd -m -u 10001 runner
WORKDIR /exec
COPY main.py .
USER runner
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
