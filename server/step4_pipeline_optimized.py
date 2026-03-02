"""
Optimized Step 4 Pipeline
Integrates all optimizations:
- Async research APIs with caching
- Two-stage LLM synthesis (filter + synthesize)
- Hybrid cache with semantic search
- Batch deduplication
- Progressive result streaming
"""

import asyncio
import logging
import time
from typing import List, Dict, Any, Optional, Callable
from datetime import datetime

logger = logging.getLogger(__name__)


class OptimizedStep4Pipeline:
    """
    Complete Step 4 pipeline with all optimizations

    Flow:
    1. Check cache (hybrid search) → 70% hit rate
    2. Generate research queries (cheap LLM)
    3. Fetch papers (async, parallel)
    4. Filter papers (cheap LLM relevance ranking)
    5. Synthesize knowledge (quality LLM with citations)
    6. Deduplicate (semantic similarity)
    7. Update cache (for next run)
    """

    def __init__(self, research_client, llm_client, deduplicator, cache,
                 embedding_model, config: Dict):
        """
        Args:
            research_client: OptimizedResearchAPIClient instance
            llm_client: LLM client (OpenAI/OpenRouter)
            deduplicator: OptimizedKnowledgeDeduplicator instance
            cache: OptimizedKnowledgeCache instance
            embedding_model: sentence-transformers model
            config: Pipeline configuration
        """
        self.research = research_client
        self.llm = llm_client
        self.dedup = deduplicator
        self.cache = cache
        self.embedding_model = embedding_model
        self.config = config

        # Configuration defaults
        self.query_model = config.get('query_model', 'gpt-4o-mini')
        self.filter_model = config.get('filter_model', 'gpt-4o-mini')
        self.synthesis_model = config.get('synthesis_model', 'gpt-4o')
        self.top_n_papers = config.get('top_n_papers', 10)
        self.cache_enabled = config.get('cache_enabled', True)
        self.dedup_enabled = config.get('dedup_enabled', True)

    async def execute(self, goal: Dict, ras: List[Dict], spvs: List[Dict],
                      progress_callback: Optional[Callable] = None) -> Dict:
        """
        Execute optimized Step 4 pipeline for one goal

        Args:
            goal: Goal pillar dict
            ras: Requirement atoms
            spvs: System properties
            progress_callback: Optional callback for progress updates

        Returns:
            Dict with scientific_pillars and metadata
        """
        start_time = time.time()
        goal_id = goal.get('id', 'unknown')

        logger.info(f"[Step4] Starting pipeline for goal: {goal_id}")

        # Progress tracking
        def report_progress(phase: str, progress: float, message: str = ""):
            if progress_callback:
                # Call with signature: progress_callback(phase: str, status: str, progress: float)
                progress_callback(phase, message, progress)

        report_progress('cache_check', 0.05, 'Checking knowledge cache...')

        # Phase 0: Cache check (if enabled)
        cached_pillars = []
        if self.cache_enabled:
            cached_pillars = await self._check_cache(goal, spvs)

            cache_hit_rate = len(cached_pillars) / max(self.config.get('target_pillars', 25), 1)

            if cache_hit_rate >= 0.7:
                logger.info(f"[Step4] High cache hit rate ({cache_hit_rate:.1%}), using cached results")
                report_progress('complete', 1.0, f'Used {len(cached_pillars)} cached pillars')

                # Build domain structures from cached pillars
                # Extract queries from cached pillars' domain_tags
                unique_domains = list(set(
                    tag for p in cached_pillars
                    for tag in p.get('domain_tags', [])
                ))
                cached_queries = [{'domain': d, 'description': f'Cached domain: {d}'} for d in unique_domains]

                return {
                    'goal_id': goal_id,
                    'scientific_pillars': cached_pillars,
                    'domain_mapping': self._build_domain_mapping(cached_queries),
                    'raw_domain_scans': self._group_pillars_by_domain(cached_pillars),
                    'cache_hit_rate': cache_hit_rate,
                    'from_cache': True,
                    'elapsed_time': time.time() - start_time
                }

            logger.info(f"[Step4] Cache hit rate: {cache_hit_rate:.1%}, proceeding with research")

        # Phase 1a: Map to solution-neutral research domains
        report_progress('domain_mapping', 0.1, 'Mapping to research domains...')
        domains = await self._map_domains(goal, ras, spvs)

        if not domains:
            logger.error(f"[Step4] No domains generated for {goal_id}")
            return {
                'goal_id': goal_id,
                'scientific_pillars': [],
                'from_cache': False,
                'elapsed_time': time.time() - start_time
            }

        logger.info(f"[Step4] Mapped to {len(domains)} research domains")

        # Phase 1b: Generate queries PER DOMAIN (maintains solution neutrality)
        report_progress('query_generation', 0.15, 'Generating domain-specific queries...')
        queries = await self._generate_queries_from_domains(domains, goal, ras)

        if not queries:
            logger.error(f"[Step4] No queries generated for {goal_id}")
            return {'error': 'Failed to generate queries', 'goal_id': goal_id}

        logger.info(f"[Step4] Generated {len(queries)} research queries")
        report_progress('paper_fetching', 0.2, f'Fetching papers for {len(queries)} queries...')

        # Phase 2: Fetch papers (async, parallel)
        papers_by_query = await self._fetch_papers(queries)

        total_papers = sum(len(papers) for papers in papers_by_query.values())
        logger.info(f"[Step4] Fetched {total_papers} papers")

        if total_papers == 0:
            logger.warning(f"[Step4] No papers found for {goal_id}")
            return {
                'goal_id': goal_id,
                'scientific_pillars': cached_pillars,
                'cache_hit_rate': len(cached_pillars) / 25 if cached_pillars else 0,
                'warning': 'No papers found'
            }

        report_progress('paper_filtering', 0.4, 'Filtering and ranking papers...')

        # Phase 3: Filter and rank papers (cheap LLM)
        top_papers_by_query = await self._filter_papers(papers_by_query, goal, ras)

        logger.info(f"[Step4] Selected top papers for synthesis")
        report_progress('synthesis', 0.5, 'Synthesizing scientific pillars...')

        # Phase 4: Synthesize knowledge (quality LLM)
        new_pillars = await self._synthesize_pillars(top_papers_by_query, goal, ras, spvs)

        logger.info(f"[Step4] Synthesized {len(new_pillars)} new pillars")
        report_progress('deduplication', 0.8, 'Deduplicating pillars...')

        # Phase 5: Deduplicate (combine new + cached)
        all_pillars = cached_pillars + new_pillars

        if self.dedup_enabled and len(all_pillars) > 1:
            deduplicated, embeddings = self.dedup.deduplicate(all_pillars, return_embeddings=True)
        else:
            deduplicated = all_pillars
            # Create embeddings for caching
            embeddings = self.embedding_model.encode(
                [self.dedup._pillar_to_text(p) for p in deduplicated],
                normalize_embeddings=True
            )

        logger.info(f"[Step4] After dedup: {len(deduplicated)} pillars")
        report_progress('caching', 0.95, 'Updating knowledge cache...')

        # Phase 6: Update cache (only new pillars)
        if self.cache_enabled and len(new_pillars) > 0:
            await self._update_cache(new_pillars, embeddings[-len(new_pillars):])

        elapsed_time = time.time() - start_time
        logger.info(f"[Step4] Pipeline complete for {goal_id} in {elapsed_time:.1f}s")

        report_progress('complete', 1.0, f'Generated {len(deduplicated)} scientific pillars')

        # Build domain hierarchy for graph visualization (using actual domains, not queries)
        domain_mapping = self._build_domain_mapping(domains)  # Pass domains, not queries
        raw_domain_scans = self._group_pillars_by_domain(deduplicated)

        return {
            'goal_id': goal_id,
            'scientific_pillars': deduplicated,
            'domain_mapping': domain_mapping,  # For graph hierarchy
            'raw_domain_scans': raw_domain_scans,  # For graph hierarchy
            'cache_hit_rate': len(cached_pillars) / len(deduplicated) if deduplicated else 0,
            'new_pillars': len(new_pillars),
            'cached_pillars': len(cached_pillars),
            'total_papers_fetched': total_papers,
            'elapsed_time': elapsed_time,
            'from_cache': False
        }

    async def _check_cache(self, goal: Dict, spvs: List[Dict]) -> List[Dict]:
        """Phase 0: Check cache for existing pillars"""
        try:
            # Extract search query from goal (handle multiple formats)
            title = goal.get('title') or goal.get('text', '')
            catastrophe = goal.get('catastrophe_primary', '')
            query = f"{title} {catastrophe}".strip()

            # If still empty, use goal ID as fallback
            if not query:
                query = goal.get('id', 'unknown_goal')

            # Extract domain and SPV tags
            domain_tags = self._extract_domain_tags(goal)
            spv_tags = [spv['id'] for spv in spvs if spv.get('id')]

            # Search cache
            cached = self.cache.search(
                query=query,
                domain_tags=domain_tags,
                spv_tags=spv_tags,
                top_k=20,
                min_quality=0.6
            )

            # Update usage stats
            if cached:
                pillar_ids = [p['pillar_id'] for p in cached]
                self.cache.update_usage(pillar_ids)

            logger.info(f"[Cache] Found {len(cached)} cached pillars")
            return cached

        except Exception as e:
            logger.error(f"[Cache] Error: {e}")
            return []

    def _extract_domain_tags(self, goal: Dict) -> List[str]:
        """Extract domain keywords from goal for cache filtering"""
        tags = []

        # Extract from title
        title = goal.get('title', '').lower()
        keywords = title.split()
        tags.extend(keywords[:5])  # Top 5 words

        # Extract from catastrophe
        catastrophe = goal.get('catastrophe_primary', '').lower()
        tags.extend(catastrophe.split()[:3])

        return list(set(tags))  # Deduplicate

    async def _map_domains(self, goal: Dict, ras: List[Dict],
                           spvs: List[Dict]) -> List[Dict]:
        """Phase 1a: Map to solution-neutral research domains"""
        try:
            # Build domain mapping prompt
            prompt = self._build_domain_mapping_prompt(goal, ras, spvs)

            # Call LLM (cheap model)
            response = await self._call_llm(
                model=self.query_model,
                messages=[
                    {"role": "system", "content": "You are a research domain mapper. Map goals to scientific fields (solution-neutral). Return ONLY valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.6,
                response_format={"type": "json_object"}
            )

            # Parse response
            import json
            result = json.loads(response)
            domains = result.get('research_domains', [])

            if not domains:
                logger.warning("[DomainMap] No domains returned, using fallback")
                # Fallback: Create generic domains
                domains = [
                    {
                        'domain_id': 'D_1',
                        'domain_name': 'Molecular Mechanisms',
                        'scope_definition': 'Molecular and cellular processes',
                        'relevance_to_goal': 'HIGH',
                        'key_research_fronts': ['Cell biology', 'Molecular biology', 'Biochemistry']
                    },
                    {
                        'domain_id': 'D_2',
                        'domain_name': 'Therapeutic Interventions',
                        'scope_definition': 'Clinical and therapeutic approaches',
                        'relevance_to_goal': 'HIGH',
                        'key_research_fronts': ['Clinical trials', 'Therapies', 'Treatments']
                    }
                ]

            logger.info(f"[DomainMap] Identified {len(domains)} domains")
            for domain in domains:
                logger.info(f"  - {domain.get('domain_name')} ({domain.get('relevance_to_goal', 'MED')} relevance)")

            return domains

        except Exception as e:
            logger.error(f"[DomainMap] Error: {e}")
            # Fallback
            return [
                {
                    'domain_id': 'D_FALLBACK',
                    'domain_name': 'General Biomedical Research',
                    'scope_definition': 'General biomedical sciences',
                    'relevance_to_goal': 'MED',
                    'key_research_fronts': ['Biology', 'Medicine']
                }
            ]

    async def _generate_queries_from_domains(self, domains: List[Dict],
                                             goal: Dict, ras: List[Dict]) -> List[Dict]:
        """Phase 1b: Generate queries PER DOMAIN (maintains solution neutrality)"""
        all_queries = []

        for domain in domains:
            try:
                # Build query generation prompt FOR THIS DOMAIN
                prompt = self._build_query_generation_prompt(domain, goal, ras)

                # Call LLM
                response = await self._call_llm(
                    model=self.query_model,
                    messages=[
                        {"role": "system", "content": "You are a research query generator. Generate PubMed queries for a specific domain. Return ONLY valid JSON."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.4,
                    response_format={"type": "json_object"}
                )

                # Parse response
                import json
                result = json.loads(response)
                queries = result.get('queries', [])

                # Tag queries with domain
                for q in queries:
                    q['domain'] = domain.get('domain_name', 'Unknown')
                    q['domain_id'] = domain.get('domain_id', '')
                    if not q.get('pubmed_query'):
                        continue
                    all_queries.append(q)

            except Exception as e:
                logger.error(f"[QueryGen] Error for domain {domain.get('domain_name')}: {e}")
                continue

        logger.info(f"[QueryGen] Generated {len(all_queries)} queries across {len(domains)} domains")
        return all_queries

    async def _generate_queries(self, goal: Dict, ras: List[Dict],
                                 spvs: List[Dict]) -> List[Dict]:
        """Phase 1: Generate research queries (cheap LLM)"""
        try:
            # Build prompt
            prompt = self._build_query_generation_prompt(goal, ras, spvs)

            # Call LLM (cheap model)
            response = await self._call_llm(
                model=self.query_model,
                messages=[
                    {"role": "system", "content": self._get_query_gen_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.4,
                response_format={"type": "json_object"}
            )

            # Parse response
            import json
            result = json.loads(response)
            queries = result.get('queries', [])

            # Filter out invalid queries
            valid_queries = []
            for q in queries:
                query_text = q.get('pubmed_query', '').strip()
                if query_text and len(query_text) > 10:  # Must have meaningful content
                    valid_queries.append(q)
                else:
                    logger.warning(f"[QueryGen] Skipping invalid/empty query: {q.get('domain', 'unknown')}")

            logger.info(f"[QueryGen] Generated {len(valid_queries)} valid queries (filtered from {len(queries)})")
            return valid_queries[:5]  # Limit to top 5

        except Exception as e:
            logger.error(f"[QueryGen] Error: {e}")
            return []

    def _build_domain_mapping_prompt(self, goal: Dict, ras: List[Dict],
                                      spvs: List[Dict]) -> str:
        """Build prompt for research domain mapping (Step 4a) - maps solution-neutral goals to research areas"""
        goal_text = goal.get('title', '') or goal.get('text', '') or goal.get('state_definition', '')
        catastrophe = goal.get('catastrophe_primary', '')

        ras_text = self._format_ras(ras[:5]) if ras else ""
        spvs_text = self._format_spvs(spvs[:5]) if spvs else ""

        return f"""Identify 3-5 research domains (well-scoped research areas) relevant to this goal.

**Goal (solution-neutral):** {goal_text}
**Catastrophe to Prevent:** {catastrophe}

**Requirements (RAs - solution-agnostic):**
{ras_text}

**System Properties (SPVs - abstract properties):**
{spvs_text}

**TASK:**
Identify 3-5 DISTINCT research domains that CONTAIN interventions to address this goal.

**DOMAIN SCOPE RULES:**
- **GOOD**: Well-scoped research area with ~25 actionable interventions
  Examples: "Accelerated Epidermal Regeneration and Wound Healing", "UV and Pollution-Induced Damage Prevention", "Hydration Optimization and Barrier Lipid Maintenance"
- **TOO BROAD**: Entire scientific discipline (hundreds of interventions)
  Examples: "Dermatology", "Cell Biology", "Medicine"
- **TOO NARROW**: Single protocol or tool (only 1-3 interventions)
  Examples: "Tretinoin Application", "Hyaluronic Acid Supplementation"

**REQUIREMENTS:**
1. Address the goal's catastrophe and requirements
2. Target high-priority SPVs
3. MECE (Mutually Exclusive, Collectively Exhaustive)
4. Each domain is a research AREA that contains multiple intervention types
5. Domains should be specific to the goal context (not generic)

Return JSON:
{{
  "research_domains": [
    {{
      "domain_id": "D_1",
      "domain_name": "Well-scoped research area name",
      "scope_definition": "What research area covers (mechanisms, processes, intervention classes)",
      "relevance_to_goal": "HIGH|MED|LOW",
      "key_research_fronts": ["Sub-area 1", "Sub-area 2", "Sub-area 3"],
      "rationale": "Why this research area is critical for the goal"
    }}
  ]
}}
"""

    def _build_query_generation_prompt(self, domain: Dict, goal: Dict, ras: List[Dict]) -> str:
        """Build prompt for query generation FROM A DOMAIN (Step 4b) - finds SPECIFIC interventions/mechanisms"""
        domain_name = domain.get('domain_name', '')
        domain_scope = domain.get('scope_definition', '')
        research_fronts = domain.get('key_research_fronts', [])

        goal_text = goal.get('title', '') or goal.get('text', '')
        ras_text = self._format_ras(ras[:3]) if ras else ""

        fronts_text = '\n'.join([f"- {front}" for front in research_fronts[:3]])

        return f"""Generate 1-2 PubMed/research queries to find SPECIFIC interventions, mechanisms, and approaches within this research domain.

**Domain:** {domain_name}
**Scope:** {domain_scope}

**Research Fronts in this Domain:**
{fronts_text}

**Goal Context (solution-neutral):** {goal_text}
**Requirements:** {ras_text}

**TASK:**
Generate 1-2 PubMed queries that will find:
- **SPECIFIC mechanisms** (molecular pathways, cellular processes, signaling cascades)
- **SPECIFIC interventions** (drugs, procedures, therapies, techniques)
- **SPECIFIC biological targets** (genes, proteins, receptors, enzymes)
- Papers with evidence (clinical trials, animal studies, in vitro experiments)

**QUERY CONSTRUCTION:**
- Scope queries to this domain (use domain-specific terminology)
- Include specific molecular/cellular terms from the research fronts
- Search for mechanisms AND therapeutic approaches AND evidence
- Include terms like: mechanism[Title/Abstract], intervention, therapy, treatment, pathway, target
- Aim for papers with actionable, evidence-based knowledge

**Example Good Queries:**
- "(epidermal growth factor OR FGF-7 OR keratinocyte proliferation) AND (wound healing OR barrier repair) AND (mechanism OR intervention)"
- "(aquaporin OR ceramide OR lipid barrier) AND (skin hydration OR transepidermal water loss) AND (clinical trial OR human study)"

Return JSON:
{{
  "queries": [
    {{
      "pubmed_query": "Specific query with domain terms, mechanism/intervention keywords, and evidence filters",
      "description": "Brief: what specific mechanisms/interventions this will find"
    }}
  ]
}}
"""

    def _format_ras(self, ras: List[Dict]) -> str:
        """Format RAs for prompt"""
        return '\n'.join([
            f"- {ra.get('atom_title', '')}: {ra.get('requirement_statement', '')[:100]}"
            for ra in ras
        ])

    def _format_spvs(self, spvs: List[Dict]) -> str:
        """Format SPVs for prompt"""
        return '\n'.join([
            f"- {spv.get('name', '')}: {spv.get('definition', '')[:100]}"
            for spv in spvs
        ])

    def _get_query_gen_system_prompt(self) -> str:
        """System prompt for query generation"""
        return """You are an expert biomedical research query generator.

Generate specific, focused queries using:
- Biological/medical terminology (genes, proteins, pathways, tissues, organs, diseases)
- Boolean operators: AND, OR (no advanced syntax like [MeSH Terms])
- Concrete mechanisms and interventions (not abstract concepts)

CRITICAL RULES:
1. NEVER generate empty or blank queries
2. Use specific biomedical terms from molecular/cellular/tissue biology
3. Avoid vague terms like "catastrophe", "system", "architecture"
4. Focus on: molecular mechanisms, cellular processes, therapeutic interventions
5. Each query must contain at least 3 specific keywords

Examples:
✓ GOOD: (epidermal barrier) AND (ceramide OR lipid) AND (aging OR photoaging)
✓ GOOD: (tight junctions) AND (claudin OR occludin) AND (skin OR epithelium)
✗ BAD: (catastrophe prevention) AND (intervention)
✗ BAD: (system maintenance)

Return ONLY valid JSON."""

    async def _fetch_papers(self, queries: List[Dict]) -> Dict[str, List[Dict]]:
        """Phase 2: Fetch papers for all queries (async parallel), grouped by domain"""
        papers_by_domain = {}
        domain_id_map = {}  # Track domain_id for each domain_name

        # Fetch all queries in parallel
        tasks = []
        for query in queries:
            task = self.research.fetch_unified_async(
                query=query.get('pubmed_query', ''),
                sources=['pubmed', 'semantic_scholar'],
                max_per_source=15
            )
            domain_name = query.get('domain', 'Unknown')
            domain_id = query.get('domain_id', '')
            tasks.append((domain_name, domain_id, task))

            # Track domain_id for this domain_name
            if domain_name and domain_id:
                domain_id_map[domain_name] = domain_id

        results = await asyncio.gather(*[t[2] for t in tasks], return_exceptions=True)

        # Organize by domain (accumulate papers from all queries in same domain)
        for i, (domain_name, domain_id, _) in enumerate(tasks):
            if isinstance(results[i], Exception):
                logger.error(f"[Fetch] Domain '{domain_name}' failed: {results[i]}")
                if domain_name not in papers_by_domain:
                    papers_by_domain[domain_name] = []
            else:
                if domain_name not in papers_by_domain:
                    papers_by_domain[domain_name] = []
                papers_by_domain[domain_name].extend(results[i])

        # Log results
        for domain_name, papers in papers_by_domain.items():
            logger.info(f"[Fetch] Domain '{domain_name}': {len(papers)} papers")

        return papers_by_domain

    async def _filter_papers(self, papers_by_query: Dict[str, List[Dict]],
                             goal: Dict, ras: List[Dict]) -> Dict[str, List[Dict]]:
        """Phase 3: Filter and rank papers by relevance (cheap LLM)"""
        filtered = {}

        for domain, papers in papers_by_query.items():
            if not papers:
                filtered[domain] = []
                continue

            # If we have few papers, skip LLM filtering and keep all
            if len(papers) <= self.top_n_papers:
                filtered[domain] = papers
                logger.info(f"[Filter] {domain}: {len(papers)} papers (keeping all, below threshold)")
                continue

            # Truncate abstracts to save tokens
            truncated_papers = []
            for paper in papers:
                p_copy = paper.copy()
                abstract = p_copy.get('abstract', '')
                if abstract:
                    # Keep first 150 words
                    words = abstract.split()
                    p_copy['abstract'] = ' '.join(words[:150]) + ('...' if len(words) > 150 else '')
                truncated_papers.append(p_copy)

            # Build filtering prompt
            prompt = self._build_filter_prompt(domain, truncated_papers, goal, ras)

            # Call cheap LLM
            try:
                response = await self._call_llm(
                    model=self.filter_model,
                    messages=[
                        {"role": "system", "content": "You are a paper relevance ranker. Return JSON with top paper indices (0-based)."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.2,
                    response_format={"type": "json_object"}
                )

                import json
                result = json.loads(response)
                top_indices = result.get('top_papers', [])[:self.top_n_papers]

                # Select top papers (validate indices)
                filtered[domain] = [papers[i] for i in top_indices if 0 <= i < len(papers)]

                # Fallback if filtering was too aggressive
                if len(filtered[domain]) == 0 and len(papers) > 0:
                    logger.warning(f"[Filter] {domain}: All papers filtered out, using fallback")
                    sorted_papers = sorted(papers, key=lambda p: p.get('quality_score', 0), reverse=True)
                    filtered[domain] = sorted_papers[:self.top_n_papers]

                logger.info(f"[Filter] {domain}: {len(papers)} → {len(filtered[domain])} papers")

            except Exception as e:
                logger.error(f"[Filter] Error for {domain}: {e}")
                # Fallback: take top papers by quality score
                sorted_papers = sorted(papers, key=lambda p: p.get('quality_score', 0), reverse=True)
                filtered[domain] = sorted_papers[:self.top_n_papers]

        return filtered

    def _build_filter_prompt(self, domain: str, papers: List[Dict],
                             goal: Dict, ras: List[Dict]) -> str:
        """Build prompt for paper filtering"""
        papers_text = []
        for i, paper in enumerate(papers):
            abstract = paper.get('abstract') or 'No abstract'
            papers_text.append(f"""[{i}] {paper.get('title', 'No title')}
Year: {paper.get('year', 'N/A')} | Citations: {paper.get('citation_count', 0)}
Abstract: {abstract[:200]}...""")

        return f"""Rank these papers by relevance to the research goal.

**Goal:** {goal.get('title', '')}
**Domain:** {domain}

**Papers:**
{chr(10).join(papers_text[:20])}

Return JSON with top {self.top_n_papers} most relevant paper indices (0-based, e.g., [0, 2, 5]):
{{
  "top_papers": [0, 2, 5, ...],
  "rationale": "Brief explanation"
}}
IMPORTANT: Use 0-based indices. First paper is [0], second is [1], etc.
"""

    async def _synthesize_pillars(self, papers_by_domain: Dict[str, List[Dict]],
                                   goal: Dict, ras: List[Dict],
                                   spvs: List[Dict]) -> List[Dict]:
        """Phase 4: Synthesize scientific pillars per domain (15-25 pillars per domain)"""
        all_pillars = []
        goal_id = goal.get('id', 'unknown')

        # Process each domain
        for idx, (domain_name, papers) in enumerate(papers_by_domain.items()):
            if not papers:
                continue

            try:
                # Generate domain_id
                domain_id = f"DOM_{goal_id}_{idx+1:02d}"

                # Build synthesis prompt for this domain
                prompt = self._build_synthesis_prompt(domain_name, domain_id, papers, goal, ras, spvs)

                # Call quality LLM
                response = await self._call_llm(
                    model=self.synthesis_model,
                    messages=[
                        {"role": "system", "content": self._get_synthesis_system_prompt()},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7,  # Higher temp for diverse interventions
                    response_format={"type": "json_object"}
                )

                import json
                result = json.loads(response)
                pillars = result.get('scientific_pillars', [])

                # Add metadata and scoring for graph compatibility
                for pillar_idx, pillar in enumerate(pillars):
                    # Critical: Add domain_id for graph grouping
                    pillar['domain_id'] = domain_id
                    pillar['domain_tags'] = [domain_name]
                    pillar['goal_id'] = goal_id

                    # Ensure proper ID format
                    if 'id' not in pillar or not pillar['id']:
                        pillar['id'] = f"S_{goal_id}_{domain_id}_{pillar_idx+1:03d}"

                    # Add backward compatibility aliases
                    if 'title' in pillar and 'intervention_title' not in pillar:
                        pillar['intervention_title'] = pillar['title']
                    if 'mechanism' in pillar and 'mechanism_summary' not in pillar:
                        pillar['mechanism_summary'] = pillar['mechanism']
                    if 'readiness_level' in pillar and 'trl' not in pillar:
                        pillar['trl'] = pillar['readiness_level']

                    # Calculate strategic_value_score for graph visualization
                    pillar['strategic_value_score'] = self._calculate_pillar_score(pillar)
                    pillar['relevance_score'] = pillar['strategic_value_score']

                    # Ensure node_id exists
                    if 'id' in pillar and 'node_id' not in pillar:
                        pillar['node_id'] = pillar['id']

                all_pillars.extend(pillars)
                logger.info(f"[Synthesis] {domain_name} ({domain_id}): {len(pillars)} pillars")

            except Exception as e:
                logger.error(f"[Synthesis] Error for {domain_name}: {e}")
                continue

        return all_pillars

    def _build_synthesis_prompt(self, domain_name: str, domain_id: str, papers: List[Dict],
                                 goal: Dict, ras: List[Dict],
                                 spvs: List[Dict]) -> str:
        """Build prompt for pillar synthesis - generates 15-25 established interventions per domain"""
        # Format papers as evidence references
        papers_text = []
        for i, paper in enumerate(papers[:10]):  # Show top 10 as examples
            abstract = paper.get('abstract') or 'No abstract'
            papers_text.append(f"""[{i+1}] {paper.get('title', 'No title')}
   Year: {paper.get('year', 'N/A')} | Citations: {paper.get('citation_count', 0)}
   PMID: {paper.get('pmid', 'N/A')} | DOI: {paper.get('doi', 'N/A')}
   Abstract: {abstract[:300]}...""")

        goal_text = goal.get('title', '') or goal.get('text', '')
        goal_id = goal.get('id', 'unknown')
        catastrophe = goal.get('catastrophe_primary', '')

        # Format SPVs
        spvs_text = '\n'.join([f"- {spv.get('spv_id', spv.get('id'))}: {spv.get('name', spv.get('text', ''))}"
                               for spv in spvs[:5]])

        # Format RAs
        ras_text = '\n'.join([f"- {ra.get('atom_title', ra.get('text', ''))[:100]}"
                              for ra in ras[:5]])

        return f"""You are "The Domain Specialist". Generate 15-25 established scientific interventions/methods/approaches within the "{domain_name}" research domain.

**CRITICAL: Scientific Pillars are ESTABLISHED INTERVENTIONS, not paper summaries.**

A scientific pillar is a specific:
- Therapeutic approach (e.g., "Topical PDGF Application")
- Mechanism/pathway (e.g., "Wnt/β-Catenin Signaling Activation")
- Method/technology (e.g., "Amniotic Membrane Scaffolds")
- Intervention class (e.g., "Low-Level Laser Therapy")

**Context:**
Goal: {goal_text}
Goal ID: {goal_id}
Catastrophe to Prevent: {catastrophe}
Domain: {domain_name}
Domain ID: {domain_id}

**System Properties (SPVs) to Address:**
{spvs_text}

**Requirements (RAs):**
{ras_text}

**Evidence Papers (use as citations, not source of pillars):**
{chr(10).join(papers_text)}

**TASK:**
Generate 15-25 ESTABLISHED, EVIDENCE-BASED interventions/methods within this domain that address the goal.

**REQUIREMENTS:**
1. Each pillar = ONE specific intervention/method/approach (NOT a paper summary)
2. Mix readiness levels: RL-3 (clinical), RL-2 (animal/human data), RL-1 (lab-validated)
3. Cover diverse aspects of the domain
4. Use papers as evidence but synthesize from broader domain knowledge
5. Assess relationship to goal: "solves", "partially_solves", "proxies_for", "violates", "enables_measurement_for"

**OUTPUT FORMAT (JSON):**
{{
  "scientific_pillars": [
    {{
      "id": "S_{goal_id}_{domain_id}_001",
      "domain_id": "{domain_id}",
      "title": "Specific intervention/method name",
      "mechanism": "Known scientific basis - how it works",
      "verified_effect": "What has been demonstrated in research",
      "readiness_level": "RL-1|RL-2|RL-3",
      "capabilities": [
        {{
          "spv_id": "SPV_X",
          "effect_direction": "INCREASE|DECREASE|STABILIZE",
          "rationale": "How this affects the SPV for this goal"
        }}
      ],
      "fragility_score": 1-10,
      "relationship_to_goal": "solves|partially_solves|proxies_for|violates|enables_measurement_for",
      "relationship_confidence": 0.0-1.0,
      "gap_analysis": "Describe gaps/limitations if partially_solves, else empty string",
      "violation_risk": "Describe risks if any, else empty string"
    }}
  ]
}}

Generate 15-25 pillars. Return ONLY valid JSON."""

    def _get_synthesis_system_prompt(self) -> str:
        """System prompt for synthesis"""
        return """You are "The Domain Specialist" - an expert in identifying ESTABLISHED scientific interventions within research domains.

Your task: SYNTHESIZE 15-25 known interventions/methods/approaches within a specific research domain.

CRITICAL UNDERSTANDING:
- Scientific Pillar = An established intervention/method/approach (e.g., "PDGF Therapy", "Wnt Signaling Activation")
- NOT a paper summary or paper extract
- Papers provided are EVIDENCE for known interventions, not the source of pillar generation

APPROACH:
1. Identify 15-25 established interventions within the domain
2. For each intervention, describe its mechanism and verified effects
3. Use provided papers as citations/evidence where relevant
4. Synthesize from domain knowledge - you know established interventions beyond just these papers

QUALITY STANDARDS:
- Each pillar = ONE specific, established intervention
- Clear mechanisms (how it works scientifically)
- Verified effects (what research has demonstrated)
- Appropriate readiness levels: RL-1 (lab), RL-2 (animal/human data), RL-3 (clinical use)
- Diverse mix across readiness levels
- All required fields present: domain_id, relationship_to_goal, gap_analysis, fragility_score, violation_risk

Return ONLY valid JSON with 15-25 pillars."""

    def _build_domain_mapping(self, domains_or_queries: List[Dict]) -> Dict:
        """
        Build domain mapping structure for graph hierarchy
        Compatible with old Step 4 format
        Handles both domain objects (new) and query objects (legacy)
        """
        research_domains = []

        for item in domains_or_queries:
            # Check if this is a domain object (has domain_id) or query object
            if 'domain_id' in item:
                # New format: domain object
                research_domains.append({
                    'domain_id': item.get('domain_id'),
                    'domain_name': item.get('domain_name', 'Research Domain'),
                    'name': item.get('domain_name', 'Research Domain'),
                    'description': item.get('scope_definition', ''),
                    'relevance_to_goal': item.get('relevance_to_goal', 'HIGH'),
                    'relevance': item.get('relevance_to_goal', 'HIGH')
                })
            else:
                # Legacy format: query object (for backward compatibility)
                research_domains.append({
                    'domain_id': f"D_{len(research_domains)+1}",
                    'domain_name': item.get('domain', 'Research Domain'),
                    'name': item.get('domain', 'Research Domain'),
                    'description': item.get('description', ''),
                    'relevance_to_goal': 'HIGH',
                    'relevance': 'HIGH'
                })

        return {
            'research_domains': research_domains
        }

    def _group_pillars_by_domain(self, pillars: List[Dict]) -> Dict:
        """
        Group pillars by domain for graph hierarchy
        Compatible with old Step 4 format
        """
        domains_dict = {}

        # Group by domain_id (critical for graph building)
        for pillar in pillars:
            # Use the domain_id from pillar (set during synthesis)
            domain_id = pillar.get('domain_id')

            if not domain_id:
                # Fallback: try to infer from domain_tags
                domain_tags = pillar.get('domain_tags', ['Unknown'])
                domain_name = domain_tags[0] if domain_tags else 'Unknown'
                # Generate a domain_id if missing
                domain_id = f"DOM_{len(domains_dict) + 1}"
                pillar['domain_id'] = domain_id
            else:
                # Get domain name from tags
                domain_tags = pillar.get('domain_tags', [])
                domain_name = domain_tags[0] if domain_tags else domain_id

            # Create domain entry if doesn't exist
            if domain_id not in domains_dict:
                domains_dict[domain_id] = {
                    'domain_id': domain_id,
                    'domain_name': domain_name,
                    'scientific_pillars': []
                }

            domains_dict[domain_id]['scientific_pillars'].append(pillar)

        return {'domains': domains_dict}

    def _calculate_pillar_score(self, pillar: Dict) -> int:
        """
        Calculate strategic value score for a pillar (0-100)

        Scoring components:
        - Base: 50 points (all pillars start here)
        - Readiness: 0-30 points (maturity level)
        - Impact: 0-20 points (citations OR recency, whichever is better)
        - Quality: 0-10 points (mechanism + effect detail)

        Key improvement: Solves "recency vs citations" paradox
        - Recent papers (<2 years): Get full impact points for being cutting-edge
        - Older papers (>2 years): Need citations to prove impact
        """
        score = 50  # Base score

        # Readiness level contribution (0-30 points)
        rl = pillar.get('readiness_level', '')
        if 'RL-3' in rl or 'clinical' in rl.lower():
            score += 30  # Clinical use - highest value
        elif 'RL-2' in rl or 'human' in rl.lower():
            score += 20  # Human/animal data - proven in mammals
        elif 'RL-1' in rl or 'lab' in rl.lower():
            score += 10  # Laboratory - early stage

        # Impact scoring (0-20 points) - Citations OR Recency, whichever is better
        source_papers = pillar.get('source_papers', [])
        citation_score = 0
        recency_score = 0

        if source_papers:
            # Calculate citation-based score (0-20)
            avg_citations = sum(p.get('citation_count', 0) for p in source_papers) / len(source_papers)
            if avg_citations >= 100:
                citation_score = 20
            elif avg_citations >= 50:
                citation_score = 15
            elif avg_citations >= 20:
                citation_score = 10
            elif avg_citations >= 5:
                citation_score = 5

            # Calculate recency-based score (0-20)
            max_year = max(p.get('year', 0) for p in source_papers)
            current_year = 2026
            paper_age = current_year - max_year

            if paper_age <= 1:
                # Brand new papers (2025-2026): Cutting edge science
                recency_score = 20
            elif paper_age == 2:
                # Very recent (2024): Still highly relevant
                recency_score = 18
            elif paper_age <= 3:
                # Recent (2023): Modern findings
                recency_score = 15
            elif paper_age <= 5:
                # Relatively recent (2021-2022)
                recency_score = 10
            elif paper_age <= 10:
                # Established (2016-2020)
                recency_score = 5
            # Older papers get 0 recency points but can still score high on citations

            # Use the BETTER of citations or recency
            # This solves the paradox: new papers score on recency, old papers on citations
            impact_score = max(citation_score, recency_score)
            score += impact_score

        # Quality indicators (0-10 points)
        quality_score = 0
        if pillar.get('mechanism') and len(pillar.get('mechanism', '')) > 50:
            quality_score += 5  # Detailed mechanism
        if pillar.get('verified_effect') and len(pillar.get('verified_effect', '')) > 50:
            quality_score += 5  # Detailed effect
        score += quality_score

        return min(100, max(0, score))

    async def _update_cache(self, pillars: List[Dict], embeddings):
        """Phase 6: Update knowledge cache"""
        try:
            self.cache.store_pillars(pillars, embeddings)
            logger.info(f"[Cache] Stored {len(pillars)} new pillars")
        except Exception as e:
            logger.error(f"[Cache] Storage error: {e}")

    async def _call_llm(self, model: str, messages: List[Dict],
                        temperature: float = 0.3,
                        response_format: Optional[Dict] = None) -> str:
        """Call LLM with error handling"""
        try:
            # Use OpenAI-compatible client
            kwargs = {
                'model': model,
                'messages': messages,
                'temperature': temperature
            }

            # Anthropic models may not support response_format through OpenRouter
            # Only add it for OpenAI models
            if response_format and not model.startswith('anthropic/'):
                kwargs['response_format'] = response_format
            elif response_format and model.startswith('anthropic/'):
                # For Anthropic, add JSON instruction to the system message
                messages[0]['content'] += "\n\nIMPORTANT: Respond ONLY with valid JSON. No explanations, no markdown, just the JSON object."

            response = await asyncio.to_thread(
                self.llm.chat.completions.create,
                **kwargs
            )

            content = response.choices[0].message.content

            # Extract JSON from markdown code blocks if present
            if '```json' in content:
                import re
                json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
                if json_match:
                    content = json_match.group(1)
            elif '```' in content:
                import re
                json_match = re.search(r'```\s*(\{.*?\})\s*```', content, re.DOTALL)
                if json_match:
                    content = json_match.group(1)

            return content.strip()

        except Exception as e:
            logger.error(f"[LLM] Error: {e}")
            raise


# Example usage
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    print("OptimizedStep4Pipeline module loaded successfully")
