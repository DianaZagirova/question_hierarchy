import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { AgentConfig } from '@/types';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface AgentCardProps {
  agent: AgentConfig;
  onUpdate: (updates: Partial<AgentConfig>) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, onUpdate }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <Card className="bg-card/50 border-border/30 hover:border-primary/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.2)] transition-all group">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              {agent.icon && (
                <span className="text-3xl" title={agent.name}>{agent.icon}</span>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg gradient-text">{agent.name}</CardTitle>
                  {agent.enabled && (
                    <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                      ACTIVE
                    </span>
                  )}
                </div>
                <CardDescription className="text-muted-foreground text-sm font-semibold">{agent.role}</CardDescription>
                {agent.description && (
                  <p className="text-xs text-muted-foreground/80 mt-1 leading-relaxed">
                    {agent.description}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer group/toggle">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  onChange={(e) => onUpdate({ enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-secondary border-2 border-border peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-primary-foreground"></div>
              </div>
            </label>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="hover:bg-secondary/50"
            >
              {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 pt-0 border-t border-border/30">
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model</label>
              <Input
                value={agent.model}
                onChange={(e) => onUpdate({ model: e.target.value })}
                disabled={!isEditing}
                className="mt-1 bg-secondary/30 border-border/50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Temperature</label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={agent.temperature}
                onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                disabled={!isEditing}
                className="mt-1 bg-secondary/30 border-border/50"
              />
            </div>
          </div>

          {agent.lens && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-1 block">
                Lens (Controlled Globally)
              </label>
              <p className="text-xs text-muted-foreground italic">
                This agent uses an epistemic lens. Configure it in the Primary Objective section above.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System Prompt</label>
            <Textarea
              value={agent.systemPrompt}
              onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
              disabled={!isEditing}
              rows={20}
              className="mt-1 font-mono text-sm bg-secondary/30 border-border/50 leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
              className={isEditing ? 'border-primary/30 text-primary hover:bg-primary/10' : 'border-border/50'}
            >
              <Settings size={16} className="mr-1" />
              {isEditing ? 'Lock' : 'Edit'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
