import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Interpolate placeholders in agent system prompts with actual values
 */
function interpolatePrompt(agentConfig) {
  let prompt = agentConfig.systemPrompt;
  
  // Replace lens placeholder
  if (agentConfig.lens) {
    prompt = prompt.replace(/\{\{LENS\}\}/g, agentConfig.lens);
    prompt = prompt.replace(/\[LENS\]/g, agentConfig.lens); // Legacy support
  }
  
  // Replace selected lens from settings
  if (agentConfig.settings?.selectedLens) {
    prompt = prompt.replace(/\{\{LENS\}\}/g, agentConfig.settings.selectedLens);
  }
  
  // Replace node count placeholders
  if (agentConfig.settings?.nodeCount) {
    const { min, max } = agentConfig.settings.nodeCount;
    
    // For Goal Pillars
    prompt = prompt.replace(/\{\{MIN_GOALS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_GOALS\}\}/g, max.toString());
    
    // For Research Domains
    prompt = prompt.replace(/\{\{MIN_DOMAINS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_DOMAINS\}\}/g, max.toString());
    
    // For Scientific Pillars
    prompt = prompt.replace(/\{\{MIN_PILLARS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_PILLARS\}\}/g, max.toString());
    
    // For L3 Questions
    prompt = prompt.replace(/\{\{MIN_L3\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L3\}\}/g, max.toString());
    
    // For Instantiation Hypotheses (IH)
    prompt = prompt.replace(/\{\{MIN_IH\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_IH\}\}/g, max.toString());
    
    // For L4 Questions
    prompt = prompt.replace(/\{\{MIN_L4\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L4\}\}/g, max.toString());
    
    // For L5 Nodes
    prompt = prompt.replace(/\{\{MIN_L5\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L5\}\}/g, max.toString());
  }
  
  // Replace any custom parameters
  if (agentConfig.settings?.customParams) {
    Object.entries(agentConfig.settings.customParams).forEach(([key, value]) => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      prompt = prompt.replace(placeholder, String(value));
    });
  }
  
  return prompt;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================
// Provider-aware client initialization
// Supports: "openai" (default) and "openrouter"
// ============================================================
const API_PROVIDER = (process.env.API_PROVIDER || 'openai').toLowerCase().trim();

let openai;
if (API_PROVIDER === 'openrouter') {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openrouterBase = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  if (!openrouterKey) {
    console.warn('\n⚠️  WARNING: API_PROVIDER=openrouter but OPENROUTER_API_KEY is not set!');
  }
  openai = new OpenAI({
    apiKey: openrouterKey,
    baseURL: openrouterBase,
  });
  console.log(`🔌 Provider: OpenRouter (${openrouterBase})`);
} else {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('🔌 Provider: OpenAI (direct)');
}

function resolveModel(modelName) {
  if (API_PROVIDER !== 'openrouter') return modelName;
  if (modelName.includes('/')) return modelName;
  return `openai/${modelName}`;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Execute a pipeline step
app.post('/api/execute-step', async (req, res) => {
  try {
    const { stepId, agentConfig, input } = req.body;

    if (!agentConfig || !agentConfig.enabled) {
      return res.status(400).json({ error: 'Agent is not enabled' });
    }

    console.log(`\n[Step ${stepId}] Executing with agent: ${agentConfig.name}`);
    console.log(`Model: ${agentConfig.model}, Temperature: ${agentConfig.temperature}`);

    // Prepare the prompt based on step
    let userPrompt = '';
    
    switch (stepId) {
      case 1: // Goal Formalization
        userPrompt = `User Goal: ${input}`;
        break;
      
      case 2: // Goal Pillars Synthesis
        userPrompt = `Q0: ${input.step1?.text || input.goal}\n\nGenerate the Goal Pillars and Bridge Lexicon.`;
        break;
      
      case 3: // Requirement Atomization
        const goalForRA = input.step2?.goals?.[0] || {};
        userPrompt = `Q0: ${input.goal}\n\nGoal Pillar:\n${JSON.stringify(goalForRA, null, 2)}\n\nGenerate Requirement Atoms for this goal.`;
        break;
      
      case 4: // Reality Mapping (Scientific Pillars)
        const bridgeLexicon = input.step2?.bridge_lexicon || {};
        userPrompt = `Bridge Lexicon:\n${JSON.stringify(bridgeLexicon, null, 2)}\n\nGenerate Scientific Pillars (S-Nodes) for 2026.`;
        break;
      
      case 5: // Strategic Matching
        const goal = input.step2?.goals?.[0] || {};
        const ras = input.step3?.requirement_atoms || [];
        const scientificPillars = input.step4?.scientific_pillars || [];
        userPrompt = `Goal: ${JSON.stringify(goal, null, 2)}\n\nRequirement Atoms: ${JSON.stringify(ras, null, 2)}\n\nScientific Pillars: ${JSON.stringify(scientificPillars, null, 2)}\n\nPerform strategic matching.`;
        break;
      
      case 6: // L3 Questions
        const matchingEdges = input.step5 || {};
        userPrompt = `Matching Results:\n${JSON.stringify(matchingEdges, null, 2)}\n\nGenerate L3 Seed Questions.`;
        break;
      
      case 7: // Instantiation Hypotheses
        const l3Questions = input.step6 || [];
        userPrompt = `L3 Questions:\n${JSON.stringify(l3Questions, null, 2)}\n\nGenerate Instantiation Hypotheses.`;
        break;
      
      case 8: // L4 Tactical Questions
        const ihs = input.step7 || [];
        userPrompt = `Instantiation Hypotheses:\n${JSON.stringify(ihs, null, 2)}\n\nGenerate L4 Tactical Questions.`;
        break;
      
      case 9: // L5/L6 Tasks
        const l4Questions = input.step8 || [];
        userPrompt = `L4 Questions:\n${JSON.stringify(l4Questions, null, 2)}\n\nGenerate L5/L6 Tasks.`;
        break;
      
      case 10: // Common Experiment Synthesis
        const q0Text = input.q0 || '';
        const l4q = input.l4_question || {};
        const l6Tasks = input.l6_tasks || [];
        userPrompt = `MASTER QUESTION (Q0):\n${q0Text}\n\nL4 TACTICAL QUESTION:\n${JSON.stringify(l4q, null, 2)}\n\nALL L6 EXPERIMENT TASKS FOR THIS L4 BRANCH (${l6Tasks.length} tasks):\n${JSON.stringify(l6Tasks, null, 2)}\n\nAnalyze whether a single, unified experiment can meaningfully address ALL the above L6 tasks.\nBe brutally critical — do NOT force unification if the tasks are fundamentally incompatible.`;
        break;
      
      default:
        userPrompt = JSON.stringify(input);
    }

    // Prepare system prompt with interpolated values
    let systemPrompt = interpolatePrompt(agentConfig);

    console.log(`\nUser Prompt (truncated): ${userPrompt.substring(0, 200)}...`);

    // Call API (OpenAI or OpenRouter)
    const apiOpts = {
      model: resolveModel(agentConfig.model),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: agentConfig.temperature,
      response_format: { type: 'json_object' },
    };

    if (API_PROVIDER === 'openrouter') {
      apiOpts.headers = {
        'HTTP-Referer': 'https://omega-point.local',
        'X-Title': 'Omega Point Pipeline',
      };
    }

    const completion = await openai.chat.completions.create(apiOpts);

    const responseText = completion.choices[0].message.content;
    console.log(`\nResponse received (${responseText.length} chars)`);

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError);
      result = { raw_response: responseText };
    }

    res.json(result);
  } catch (error) {
    console.error('Error executing step:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.response?.data || error.stack
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 OMEGA-POINT Server running on port ${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
  console.log(`🔌 API Provider: ${API_PROVIDER}`);
  if (API_PROVIDER === 'openrouter') {
    console.log(`🔑 OpenRouter API Key: ${process.env.OPENROUTER_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  } else {
    console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  }
  console.log('');
});
