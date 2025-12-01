import { useState, useEffect } from 'react';
import { Code, Eye, Plus, X, Copy, Save, RotateCcw, FileText } from 'lucide-react';
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_VARIABLES } from '../../templates/email';

const EmailTemplateEditor = ({ templates, onSave, onToast, logoUrl }) => {
    const [selectedTemplate, setSelectedTemplate] = useState('fileShared');
    const [editedTemplates, setEditedTemplates] = useState({});
    const [viewMode, setViewMode] = useState('code'); // 'code' | 'preview'
    const [customVariables, setCustomVariables] = useState([]);
    const [newVarKey, setNewVarKey] = useState('');
    const [newVarDesc, setNewVarDesc] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Initialize with saved templates or defaults
        const initial = {};
        Object.keys(DEFAULT_EMAIL_TEMPLATES).forEach(key => {
            initial[key] = templates?.[key] || DEFAULT_EMAIL_TEMPLATES[key];
        });
        setEditedTemplates(initial);
        
        // Load custom variables
        if (templates?.customVariables) {
            setCustomVariables(templates.customVariables);
        }
    }, [templates]);

    const currentTemplate = editedTemplates[selectedTemplate] || DEFAULT_EMAIL_TEMPLATES[selectedTemplate];

    const handleTemplateChange = (field, value) => {
        setEditedTemplates(prev => ({
            ...prev,
            [selectedTemplate]: {
                ...prev[selectedTemplate],
                [field]: value
            }
        }));
    };

    const insertVariable = (variable) => {
        const textarea = document.getElementById('html-editor');
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = currentTemplate.html;
            const newText = text.substring(0, start) + variable + text.substring(end);
            handleTemplateChange('html', newText);
            
            // Restore cursor position
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(start + variable.length, start + variable.length);
            }, 0);
        }
    };

    const addCustomVariable = () => {
        if (!newVarKey.trim()) return;
        
        const key = newVarKey.startsWith('{{') ? newVarKey : `{{${newVarKey.replace(/[{}]/g, '')}}}`;
        const newVar = { key, description: newVarDesc || key };
        
        setCustomVariables(prev => [...prev, newVar]);
        setNewVarKey('');
        setNewVarDesc('');
    };

    const removeCustomVariable = (index) => {
        setCustomVariables(prev => prev.filter((_, i) => i !== index));
    };

    const resetTemplate = () => {
        if (confirm('¿Restablecer esta plantilla a los valores por defecto?')) {
            setEditedTemplates(prev => ({
                ...prev,
                [selectedTemplate]: DEFAULT_EMAIL_TEMPLATES[selectedTemplate]
            }));
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave({
                emailTemplates: JSON.stringify({
                    ...editedTemplates,
                    customVariables
                })
            });
            onToast({ message: 'Plantillas guardadas correctamente', type: 'success' });
        } catch (err) {
            console.error(err);
            onToast({ message: 'Error al guardar plantillas', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const getPreviewHtml = () => {
        let html = currentTemplate.html;
        // Replace variables with sample values for preview
        const sampleValues = {
            '{{username}}': 'Juan García',
            '{{email}}': 'juan@ejemplo.com',
            '{{fileName}}': 'documento.pdf',
            '{{fileSize}}': '2.5 MB',
            '{{downloadLink}}': '#',
            '{{expirationDate}}': '15 de Diciembre, 2025',
            '{{appName}}': 'Sendu',
            '{{appUrl}}': 'https://sendu.lat',
            '{{logoUrl}}': logoUrl || 'https://sendu.lat/logo.png',
            '{{verificationLink}}': '#',
            '{{resetLink}}': '#',
        };
        
        Object.entries(sampleValues).forEach(([key, value]) => {
            html = html.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
        });
        
        return html;
    };

    const allVariables = [...EMAIL_VARIABLES, ...customVariables];

    return (
        <div className="space-y-6">
            {/* Template Selector */}
            <div className="flex flex-wrap gap-2">
                {Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([key, tmpl]) => (
                    <button
                        key={key}
                        onClick={() => setSelectedTemplate(key)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            selectedTemplate === key
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                    >
                        {tmpl.name}
                    </button>
                ))}
            </div>

            {/* Subject Field */}
            <div>
                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Asunto del Email
                </label>
                <input
                    type="text"
                    value={currentTemplate.subject}
                    onChange={(e) => handleTemplateChange('subject', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                    placeholder="Asunto del correo..."
                />
            </div>

            {/* Variables Panel */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-700 dark:text-gray-300">Variables Disponibles</h4>
                    <span className="text-xs text-gray-500">Haz clic para insertar</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                    {allVariables.map((v, i) => (
                        <button
                            key={i}
                            onClick={() => insertVariable(v.key)}
                            title={v.description}
                            className="px-3 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-mono text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors flex items-center gap-1"
                        >
                            {v.key}
                            {customVariables.includes(v) && (
                                <X
                                    size={14}
                                    className="text-red-500 hover:text-red-700"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeCustomVariable(customVariables.indexOf(v));
                                    }}
                                />
                            )}
                        </button>
                    ))}
                </div>
                
                {/* Add Custom Variable */}
                <div className="flex gap-2 items-end">
                    <div className="flex-grow">
                        <label className="block text-xs text-gray-500 mb-1">Nueva Variable</label>
                        <input
                            type="text"
                            value={newVarKey}
                            onChange={(e) => setNewVarKey(e.target.value)}
                            placeholder="nombreVariable"
                            className="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <div className="flex-grow">
                        <label className="block text-xs text-gray-500 mb-1">Descripción</label>
                        <input
                            type="text"
                            value={newVarDesc}
                            onChange={(e) => setNewVarDesc(e.target.value)}
                            placeholder="Descripción de la variable"
                            className="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <button
                        onClick={addCustomVariable}
                        disabled={!newVarKey.trim()}
                        className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={18} />
                    </button>
                </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    <button
                        onClick={() => setViewMode('code')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            viewMode === 'code'
                                ? 'bg-gray-800 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                    >
                        <Code size={18} /> Código HTML
                    </button>
                    <button
                        onClick={() => setViewMode('preview')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            viewMode === 'preview'
                                ? 'bg-gray-800 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                    >
                        <Eye size={18} /> Vista Previa
                    </button>
                </div>
                <button
                    onClick={resetTemplate}
                    className="flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-red-600 transition-colors"
                    title="Restablecer plantilla"
                >
                    <RotateCcw size={18} /> Restablecer
                </button>
            </div>

            {/* Editor / Preview */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                {viewMode === 'code' ? (
                    <textarea
                        id="html-editor"
                        value={currentTemplate.html}
                        onChange={(e) => handleTemplateChange('html', e.target.value)}
                        className="w-full h-96 p-4 font-mono text-sm bg-gray-900 text-gray-100 outline-none resize-none"
                        spellCheck={false}
                    />
                ) : (
                    <div className="bg-white h-96 overflow-auto">
                        <iframe
                            srcDoc={getPreviewHtml()}
                            className="w-full h-full border-0"
                            title="Email Preview"
                        />
                    </div>
                )}
            </div>

            {/* Save Button */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium disabled:opacity-50"
                >
                    {saving ? (
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Save size={18} />
                    )}
                    Guardar Plantillas
                </button>
            </div>
        </div>
    );
};

export default EmailTemplateEditor;
