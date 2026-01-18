import { useState, useEffect } from 'react';
import { Code, Eye, Plus, X, Save, RotateCcw, ChevronRight, Share2, Download, UserPlus, ShieldCheck, KeyRound, Loader2 } from 'lucide-react';
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_VARIABLES } from '../../templates/email';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../ui/ConfirmModal';

// Iconos y colores para cada tipo de plantilla
const TEMPLATE_CONFIG = {
    fileShared: { 
        icon: Share2, 
        color: 'blue',
        bgDark: 'bg-blue-500/20',
        bgLight: 'bg-blue-100',
        textDark: 'text-blue-400',
        textLight: 'text-blue-600'
    },
    downloadNotification: { 
        icon: Download, 
        color: 'green',
        bgDark: 'bg-green-500/20',
        bgLight: 'bg-green-100',
        textDark: 'text-green-400',
        textLight: 'text-green-600'
    },
    welcome: { 
        icon: UserPlus, 
        color: 'purple',
        bgDark: 'bg-purple-500/20',
        bgLight: 'bg-purple-100',
        textDark: 'text-purple-400',
        textLight: 'text-purple-600'
    },
    verification: { 
        icon: ShieldCheck, 
        color: 'amber',
        bgDark: 'bg-amber-500/20',
        bgLight: 'bg-amber-100',
        textDark: 'text-amber-400',
        textLight: 'text-amber-600'
    },
    passwordReset: { 
        icon: KeyRound, 
        color: 'red',
        bgDark: 'bg-red-500/20',
        bgLight: 'bg-red-100',
        textDark: 'text-red-400',
        textLight: 'text-red-600'
    }
};

const EmailTemplateEditor = ({ templates, onSave, onToast, logoUrl }) => {
    const { isDark } = useTheme();
    const [selectedTemplate, setSelectedTemplate] = useState('fileShared');
    const [editedTemplates, setEditedTemplates] = useState({});
    const [viewMode, setViewMode] = useState('code');
    const [customVariables, setCustomVariables] = useState([]);
    const [newVarKey, setNewVarKey] = useState('');
    const [newVarDesc, setNewVarDesc] = useState('');
    const [saving, setSaving] = useState(false);
    const [resetModalOpen, setResetModalOpen] = useState(false);
    const [showVariables, setShowVariables] = useState(false);

    useEffect(() => {
        const initial = {};
        Object.keys(DEFAULT_EMAIL_TEMPLATES).forEach(key => {
            initial[key] = templates?.[key] || DEFAULT_EMAIL_TEMPLATES[key];
        });
        setEditedTemplates(initial);
        
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
        setResetModalOpen(true);
    };

    const confirmResetTemplate = () => {
        setEditedTemplates(prev => ({
            ...prev,
            [selectedTemplate]: DEFAULT_EMAIL_TEMPLATES[selectedTemplate]
        }));
        setResetModalOpen(false);
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

    const inputClass = `w-full px-4 py-3 rounded-xl outline-none transition-all ${
        isDark 
            ? 'bg-zinc-800/50 border border-zinc-700 text-white placeholder-zinc-500 focus:border-red-500' 
            : 'bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-red-500'
    }`;

    const cardClass = `rounded-xl p-4 ${isDark ? 'bg-zinc-800/30 border border-zinc-700/50' : 'bg-zinc-50 border border-zinc-200'}`;

    return (
        <div className="space-y-5">
            {/* Template Selector - Cards */}
            <div className="grid grid-cols-5 gap-3">
                {Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([key, tmpl]) => {
                    const config = TEMPLATE_CONFIG[key];
                    const Icon = config?.icon || Share2;
                    const isActive = selectedTemplate === key;
                    
                    return (
                        <button
                            key={key}
                            onClick={() => setSelectedTemplate(key)}
                            className={`relative flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
                                isActive
                                    ? isDark 
                                        ? 'bg-zinc-700 ring-2 ring-red-500' 
                                        : 'bg-white ring-2 ring-red-500 shadow-lg'
                                    : isDark 
                                        ? 'bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700' 
                                        : 'bg-zinc-50 hover:bg-white border border-zinc-200 hover:shadow-md'
                            }`}
                        >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                isDark ? config.bgDark : config.bgLight
                            }`}>
                                <Icon size={20} className={isDark ? config.textDark : config.textLight} />
                            </div>
                            <span className={`text-xs font-medium text-center leading-tight ${
                                isActive 
                                    ? isDark ? 'text-white' : 'text-zinc-900'
                                    : isDark ? 'text-zinc-400' : 'text-zinc-600'
                            }`}>
                                {tmpl.name}
                            </span>
                            {isActive && (
                                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Subject Field */}
            <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    Asunto del Email
                </label>
                <input
                    type="text"
                    value={currentTemplate.subject}
                    onChange={(e) => handleTemplateChange('subject', e.target.value)}
                    className={inputClass}
                    placeholder="Asunto del correo..."
                />
            </div>

            {/* Variables Panel - Collapsible */}
            <div className={cardClass}>
                <button 
                    onClick={() => setShowVariables(!showVariables)}
                    className="w-full flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        <span className={`font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>
                            Variables Disponibles
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>
                            {allVariables.length}
                        </span>
                    </div>
                    <ChevronRight 
                        size={18} 
                        className={`transition-transform ${isDark ? 'text-zinc-500' : 'text-zinc-400'} ${showVariables ? 'rotate-90' : ''}`} 
                    />
                </button>
                
                {showVariables && (
                    <div className="mt-4 space-y-4">
                        <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            Haz clic en una variable para insertarla en el editor
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {allVariables.map((v, i) => (
                                <button
                                    key={i}
                                    onClick={() => insertVariable(v.key)}
                                    title={v.description}
                                    className={`group px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
                                        isDark 
                                            ? 'bg-zinc-700/50 text-red-400 hover:bg-red-600/20 border border-zinc-600 hover:border-red-500/50' 
                                            : 'bg-white text-red-600 hover:bg-red-50 border border-zinc-200 hover:border-red-300'
                                    }`}
                                >
                                    {v.key}
                                    {customVariables.includes(v) && (
                                        <X
                                            size={12}
                                            className={`opacity-50 group-hover:opacity-100 ${isDark ? 'text-red-400' : 'text-red-500'}`}
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
                        <div className={`pt-3 border-t ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                            <p className={`text-xs font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                Agregar variable personalizada
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newVarKey}
                                    onChange={(e) => setNewVarKey(e.target.value)}
                                    placeholder="nombre"
                                    className={`flex-1 px-3 py-2 text-sm rounded-lg outline-none transition-all ${
                                        isDark 
                                            ? 'bg-zinc-800 border border-zinc-600 text-white placeholder-zinc-500 focus:border-red-500' 
                                            : 'bg-white border border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-red-500'
                                    }`}
                                />
                                <input
                                    type="text"
                                    value={newVarDesc}
                                    onChange={(e) => setNewVarDesc(e.target.value)}
                                    placeholder="Descripción"
                                    className={`flex-1 px-3 py-2 text-sm rounded-lg outline-none transition-all ${
                                        isDark 
                                            ? 'bg-zinc-800 border border-zinc-600 text-white placeholder-zinc-500 focus:border-red-500' 
                                            : 'bg-white border border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-red-500'
                                    }`}
                                />
                                <button
                                    onClick={addCustomVariable}
                                    disabled={!newVarKey.trim()}
                                    className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Plus size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* View Mode Toggle & Actions */}
            <div className="flex items-center justify-between">
                <div className={`flex p-1 rounded-xl ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
                    <button
                        onClick={() => setViewMode('code')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            viewMode === 'code'
                                ? isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm'
                                : isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                    >
                        <Code size={16} /> 
                        <span className="hidden sm:inline">Código</span>
                    </button>
                    <button
                        onClick={() => setViewMode('preview')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            viewMode === 'preview'
                                ? isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm'
                                : isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                    >
                        <Eye size={16} /> 
                        <span className="hidden sm:inline">Vista Previa</span>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={resetTemplate}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                            isDark 
                                ? 'text-zinc-400 hover:text-red-400 hover:bg-zinc-800' 
                                : 'text-zinc-500 hover:text-red-600 hover:bg-zinc-100'
                        }`}
                        title="Restablecer plantilla"
                    >
                        <RotateCcw size={16} />
                        <span className="hidden sm:inline">Restablecer</span>
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            isDark 
                                ? 'bg-red-600 hover:bg-red-500 text-white' 
                                : 'bg-red-600 hover:bg-red-500 text-white'
                        } disabled:opacity-50`}
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        <span className="hidden sm:inline">Guardar</span>
                    </button>
                </div>
            </div>

            {/* Editor / Preview */}
            <div className={`rounded-xl overflow-hidden border ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                {viewMode === 'code' ? (
                    <textarea
                        id="html-editor"
                        value={currentTemplate.html}
                        onChange={(e) => handleTemplateChange('html', e.target.value)}
                        className={`w-full h-80 p-4 font-mono text-sm outline-none resize-none ${
                            isDark 
                                ? 'bg-zinc-900 text-zinc-100' 
                                : 'bg-zinc-900 text-zinc-100'
                        }`}
                        spellCheck={false}
                    />
                ) : (
                    <div className="bg-white h-80 overflow-auto">
                        <iframe
                            srcDoc={getPreviewHtml()}
                            className="w-full h-full border-0"
                            title="Email Preview"
                        />
                    </div>
                )}
            </div>

            {/* Modal de confirmación */}
            <ConfirmModal
                isOpen={resetModalOpen}
                onClose={() => setResetModalOpen(false)}
                onConfirm={confirmResetTemplate}
                title="Restablecer plantilla"
                message="¿Estás seguro de que deseas restablecer esta plantilla a los valores por defecto? Se perderán todos los cambios realizados."
                confirmText="Restablecer"
                variant="warning"
            />
        </div>
    );
};

export default EmailTemplateEditor;
