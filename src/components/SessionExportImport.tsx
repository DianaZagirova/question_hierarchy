import React, { useState } from 'react';
import { Download, Upload, FileJson, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from './ui/Button';
import * as sessionApi from '@/lib/sessionApi';

interface SessionExportImportProps {
  onImportComplete?: () => void;
}

export const SessionExportImport: React.FC<SessionExportImportProps> = ({ onImportComplete }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExportAll = async () => {
    try {
      setIsExporting(true);
      setMessage(null);

      const exportData = await sessionApi.exportAllSessions();
      sessionApi.downloadExportAsFile(exportData, `omega-point-all-sessions-${Date.now()}.json`);

      setMessage({
        type: 'success',
        text: `Successfully exported ${exportData.metadata.total_sessions} session(s)`
      });
    } catch (error) {
      console.error('Export failed:', error);
      setMessage({
        type: 'error',
        text: 'Failed to export sessions'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setMessage(null);

      // Read file
      const importData = await sessionApi.readImportFile(file);

      // Import sessions
      const result = await sessionApi.importSessions(importData);

      setMessage({
        type: 'success',
        text: `Successfully imported ${result.imported} session(s)`
      });

      // Notify parent component
      if (onImportComplete) {
        onImportComplete();
      }

      // Reset file input
      event.target.value = '';
    } catch (error) {
      console.error('Import failed:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to import sessions'
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card/50 backdrop-blur-sm rounded-xl p-6 border border-border/30">
        <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          <FileJson className="w-5 h-5 text-primary" />
          Session Export/Import
        </h3>

        <p className="text-sm text-muted-foreground mb-6">
          Export your sessions to backup your work or transfer to another device. Import previously exported sessions to restore your data.
        </p>

        <div className="flex flex-wrap gap-3">
          {/* Export Button */}
          <Button
            onClick={handleExportAll}
            disabled={isExporting}
            className="bg-gradient-to-r from-primary/20 to-accent/20 hover:from-primary/30 hover:to-accent/30 border border-primary/50 text-primary hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export All Sessions'}
          </Button>

          {/* Import Button */}
          <div className="relative">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              disabled={isImporting}
              className="hidden"
              id="import-file-input"
            />
            <label
              htmlFor="import-file-input"
              className={`inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all duration-200 bg-gradient-to-r from-accent/20 to-primary/20 hover:from-accent/30 hover:to-primary/30 border border-accent/50 text-accent hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] ${isImporting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <Upload className="w-4 h-4 mr-2" />
              {isImporting ? 'Importing...' : 'Import Sessions'}
            </label>
          </div>
        </div>

        {/* Status Message */}
        {message && (
          <div
            className={`mt-4 p-3 rounded-lg border flex items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-300 ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            )}
            <div className="text-sm">{message.text}</div>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <p className="text-sm text-blue-400 font-medium mb-2 flex items-center gap-2">
          <FileJson size={16} />
          Export Format
        </p>
        <ul className="text-xs text-blue-300/80 space-y-1 ml-6 list-disc">
          <li>JSON format with metadata and session data</li>
          <li>Includes all pipeline steps, agents, and versions</li>
          <li>Compatible with future versions of Omega Point</li>
          <li>Can be imported into any browser session</li>
        </ul>
      </div>
    </div>
  );
};
