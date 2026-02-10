# OMEGA-POINT Python Backend

Flask-based backend server for the OMEGA-POINT application.

## Setup

1. **Create a virtual environment (recommended):**
```bash
cd server
python3 -m venv venv
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate  # On Windows
```

2. **Install dependencies:**
```bash
pip install -r requirements.txt
```

3. **Configure environment:**
Create a `.env` file in the project root (not in server folder):
```
OPENAI_API_KEY=sk-your-key-here
PORT=3001
```

4. **Run the server:**
```bash
python app.py
```

The server will start on `http://localhost:3001`

## API Endpoints

### Health Check
```
GET /api/health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2026-01-24T23:11:00.000000"
}
```

### Execute Step
```
POST /api/execute-step
```

Request body:
```json
{
  "stepId": 1,
  "agentConfig": {
    "name": "Agent Initiator",
    "model": "gpt-4-turbo-preview",
    "temperature": 0.3,
    "systemPrompt": "...",
    "enabled": true
  },
  "input": "defeat biological aging"
}
```

Response:
```json
{
  "text": "What architecture is required to keep Homo sapiens..."
}
```

## Development

The server uses Flask with CORS enabled for development. In production, you should:
- Set `debug=False`
- Use a production WSGI server (gunicorn, uwsgi)
- Configure proper CORS origins
- Add rate limiting
- Add authentication if needed

## Troubleshooting

**Import errors:**
- Make sure virtual environment is activated
- Run `pip install -r requirements.txt`

**OpenAI API errors:**
- Check your API key in `.env`
- Verify you have API credits
- Check rate limits

**CORS errors:**
- Flask-CORS is configured to allow all origins in development
- For production, configure specific origins
