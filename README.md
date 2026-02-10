# Omega Point

A hierarchical research framework for breaking down complex scientific goals into actionable experiments. Think of it as a smart decomposition engine that takes big ambitious questions and turns them into a structured tree of experiments you can actually run.

## What it does

You give it a high-level goal (like "achieve biological immortality" or "develop sustainable fusion energy"), and it:

1. Breaks it down into major scientific pillars
2. Maps out the requirements for each pillar
3. Scans existing research domains to see what's already known
4. Identifies gaps and generates frontier questions
5. Creates specific experimental hypotheses
6. Decomposes those into tactical steps
7. Outputs concrete experiments with protocols

The whole process uses LLMs at each stage, with different "agents" specialized for different types of reasoning. You can configure which models to use, adjust their temperature, and even customize the epistemic lens (like "prioritize safety" or "bias toward rapid iteration").

## Quick start

### Development setup

```bash
# Clone and install
npm install
cd server && pip install -r requirements.txt

# Set up your environment
cp .env.example .env
# Edit .env and add your OpenAI or OpenRouter API key

# Run the dev server (frontend + backend)
npm run dev
```

Frontend runs on `localhost:5173`, backend on `localhost:3001`.

### Production deployment with Docker

```bash
# Copy and configure environment
cp .env.production.example .env
# Edit .env - at minimum set your API keys and change DB_PASSWORD

# Build and run
docker compose up --build -d

# Check it's running
docker compose ps
docker compose logs -f
```

App runs on `localhost:3002` (or whatever PORT you set).

## Architecture

**Frontend**: React + TypeScript + Vite. Uses Zustand for state management and D3 for graph visualization.

**Backend**: Flask + Gunicorn. Handles LLM calls, batch processing, and serves the built frontend in production.

**Multi-user support**: PostgreSQL stores session state, Redis handles real-time progress tracking across workers. Each user gets an isolated session so multiple people can use it simultaneously without stepping on each other.

The pipeline has 10 steps total, though Step 5 is currently skipped (we merged that agent's functionality into Step 4 to reduce redundancy).

## Configuration

Everything's in `.env`. Key things to set:

- `API_PROVIDER`: Use `openai` or `openrouter`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`: Your LLM API key
- `MAX_BATCH_WORKERS`: How many parallel requests for batch processing (Step 4 is the big one)
- `DATABASE_URL` and `REDIS_URL`: For multi-user sessions (Docker handles this automatically)

Check `ENV_VARIABLES_GUIDE.md` if you need details on all the options.

## How to use it

1. **Enter your goal**: Start with a high-level scientific objective
2. **Configure agents**: Each step has a dedicated agent - you can adjust their models and prompts
3. **Run the pipeline**: Execute steps sequentially (some have batch processing)
4. **Explore the graph**: View results as an interactive hierarchical tree
5. **Refine nodes**: Use AI editing to improve specific nodes
6. **Chat with your graph**: Ask questions about specific nodes or the whole structure

The graph visualization is actually pretty useful - you can select specific nodes, expand/collapse branches, and see the full decomposition at a glance.

## Project structure

```
omega-point-app/
├── src/                    # Frontend React app
│   ├── components/         # UI components
│   ├── store/             # Zustand state management
│   ├── lib/               # API client, utilities
│   └── config/            # Agent configurations
├── server/                # Flask backend
│   ├── app.py            # Main server file
│   ├── database.py       # PostgreSQL session management
│   ├── redis_client.py   # Redis progress tracking
│   └── init.sql          # Database schema
├── docker-compose.yml    # Production deployment
└── .env                  # Your configuration (don't commit this!)
```

## Multi-user sessions

The app now supports multiple concurrent users. Each person gets their own session with isolated state:

- Sessions are identified by UUID (auto-generated on first visit)
- State is stored in PostgreSQL (survives server restarts)
- Progress tracking uses Redis (shared across Gunicorn workers)
- Sessions expire after 7 days of inactivity (configurable)

If you're running this for a team, just deploy it once and everyone can use it simultaneously. No authentication needed - sessions are anonymous but isolated.

## Development notes

**Step 4 is the slow one**: It runs in two phases - first mapping domains (fast), then scanning each domain in parallel (slow). We use ThreadPoolExecutor for the batch processing, and you can watch progress via Server-Sent Events.

**Agent prompts are in the frontend**: Check `src/config/agents.ts` if you want to modify how agents think. Each one has a system prompt you can customize.

**Graph rendering can be heavy**: For large hierarchies (1000+ nodes), the D3 force layout might lag. We added controls to hide branches and zoom to specific sections.

**localStorage is a fallback**: If the server is unavailable, the app continues working with localStorage-only mode. When the server comes back, it migrates the data automatically.

## Troubleshooting

**"Worker timeout errors"**: LLM calls can be slow. Increase `GUNICORN_TIMEOUT` in `.env` (default is 300 seconds).

**"Database connection failed"**: Make sure PostgreSQL is running and `DB_PASSWORD` matches in both `DATABASE_URL` and `DB_PASSWORD` variables.

**"Too many requests" from OpenAI**: Lower `MAX_BATCH_WORKERS` to reduce parallel requests, or switch to `API_PROVIDER=openrouter` which has higher rate limits.

**Step 4 stuck at 10%**: That's phase 4a (domain mapping). Phase 4b (domain scans) is where most of the work happens. Just wait - it'll get there.

## Contributing

Feel free to fork and modify. The agent system is designed to be extensible - you can add new steps or customize existing ones pretty easily.

If you make improvements to the agent prompts or find better model configurations, those are probably the most valuable things to share back.

## License

MIT - do whatever you want with it.

## Notes

This started as an experiment in using LLMs for scientific decomposition. The multi-agent approach with specialized reasoning at each stage seems to work better than throwing everything at one giant prompt.

The "epistemic lens" feature is interesting - you can bias the entire pipeline toward different priorities (safety-first, speed-first, cost-conscious, etc.) and it actually changes the output in meaningful ways.

Step 10 (Common Experiment Synthesis) is new - it looks across all the L6 experiments and finds common protocols that multiple hypotheses need. Saves you from reinventing the same experiment 50 times.

Anyway, that's the gist. Check out the code, try it out, break it, whatever.
