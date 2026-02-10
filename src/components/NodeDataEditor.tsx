import React, { useState, useEffect } from 'react';
import { X, Save, Edit3 } from 'lucide-react';
import { Button } from './ui/Button';

interface NodeDataEditorProps {
  isOpen: boolean;
  onClose: () => void;
  nodeData: any;
  nodeLabel: string;
  onSave: (updatedData: any) => void;
}

export const NodeDataEditor: React.FC<NodeDataEditorProps> = ({
  isOpen,
  onClose,
  nodeData,
  nodeLabel,
  onSave,
}) => {
  const [editedData, setEditedData] = useState<any>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen && nodeData) {
      // Deep clone the node data
      setEditedData(JSON.parse(JSON.stringify(nodeData)));
      setHasChanges(false);
    }
  }, [isOpen, nodeData]);

  if (!isOpen) return null;

  const handleFieldChange = (path: string[], value: any) => {
    const newData = JSON.parse(JSON.stringify(editedData));
    let target = newData;

    // Navigate to the parent of the target field
    for (let i = 0; i < path.length - 1; i++) {
      target = target[path[i]];
    }

    // Update the final field
    target[path[path.length - 1]] = value;

    setEditedData(newData);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(editedData);
    setHasChanges(false);
    onClose();
  };

  const renderField = (key: string, value: any, path: string[] = []) => {
    const currentPath = [...path, key];

    // Skip rendering certain technical fields
    const skipFields = ['id', 'type', 'parent_node_id', 'parent_goal_id', 'l4_reference_id'];
    if (skipFields.includes(key)) {
      return null;
    }

    // Handle different value types
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      // String fields - use textarea for long text, input for short
      const isLongText = value.length > 100;
      return (
        <div key={currentPath.join('.')} className="mb-4">
          <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
            {formatFieldName(key)}
          </label>
          {isLongText ? (
            <textarea
              value={value}
              onChange={(e) => handleFieldChange(currentPath, e.target.value)}
              className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground leading-relaxed focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-y min-h-[100px]"
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => handleFieldChange(currentPath, e.target.value)}
              className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            />
          )}
        </div>
      );
    }

    if (typeof value === 'number') {
      return (
        <div key={currentPath.join('.')} className="mb-4">
          <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
            {formatFieldName(key)}
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(currentPath, parseFloat(e.target.value) || 0)}
            className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
          />
        </div>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <div key={currentPath.join('.')} className="mb-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => handleFieldChange(currentPath, e.target.checked)}
            className="w-4 h-4 text-primary bg-secondary border-border rounded focus:ring-primary"
          />
          <label className="text-sm font-semibold text-foreground">
            {formatFieldName(key)}
          </label>
        </div>
      );
    }

    if (Array.isArray(value)) {
      // Handle arrays of strings or simple values
      if (value.length > 0 && typeof value[0] === 'string') {
        return (
          <div key={currentPath.join('.')} className="mb-4">
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
              {formatFieldName(key)}
            </label>
            <div className="space-y-2">
              {value.map((item, index) => (
                <input
                  key={index}
                  type="text"
                  value={item}
                  onChange={(e) => {
                    const newArray = [...value];
                    newArray[index] = e.target.value;
                    handleFieldChange(currentPath, newArray);
                  }}
                  className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                />
              ))}
            </div>
          </div>
        );
      }
      // For complex arrays, show as JSON (read-only for now)
      return (
        <div key={currentPath.join('.')} className="mb-4">
          <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
            {formatFieldName(key)} (Complex Array - View Only)
          </label>
          <pre className="bg-secondary/30 border border-border/50 rounded-md p-3 text-xs text-foreground overflow-x-auto">
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      );
    }

    if (typeof value === 'object') {
      // Recursively render nested objects
      return (
        <div key={currentPath.join('.')} className="mb-4 border-l-2 border-primary/30 pl-4">
          <div className="text-xs font-bold text-primary uppercase mb-2">{formatFieldName(key)}</div>
          <div className="space-y-2">
            {Object.keys(value).map((nestedKey) =>
              renderField(nestedKey, value[nestedKey], currentPath)
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  const formatFieldName = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card/95 backdrop-blur-md rounded-lg shadow-2xl border border-primary/30 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-accent/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Edit3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Edit Node Data</h2>
              <p className="text-xs text-muted-foreground">{nodeLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-blue-400">
              <strong>Note:</strong> You can edit the values of this node's data. Changes are saved only for this session and won't affect the original pipeline configuration.
            </p>
          </div>

          {editedData && Object.keys(editedData).map((key) =>
            renderField(key, editedData[key])
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border/50 bg-secondary/20">
          <div className="text-xs text-muted-foreground">
            {hasChanges ? (
              <span className="text-amber-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Unsaved changes
              </span>
            ) : (
              <span className="text-green-400">No changes</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              className="border-border/50 hover:bg-secondary/50"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges}
              className="bg-gradient-to-r from-primary to-accent hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={14} className="mr-1" />
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
