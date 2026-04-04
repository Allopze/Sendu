/**
 * Email module
 *
 * Centralises SMTP transporter creation, templated email rendering
 * and email delivery (direct + job queue).
 */
import nodemailer from 'nodemailer';
import logger from './logger.js';
import { summarizeEmailForLogs } from './emailLog.js';
import { enqueueEmail } from './jobQueue.js';

// ── HTML helpers ────────────────────────────────────────────

/** HTML-escape helper to prevent XSS in email templates */
export const escapeHtml = (str) => {
    if (!str || typeof str !== 'string') return str || '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

/** Replace variables in a Handlebars-like template */
export const replaceTemplateVariables = (template, variables) => {
    let result = template;

    // {{#if variable}}...{{else}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
        (_match, varName, ifContent, elseContent) => {
            return variables[varName] ? ifContent : elseContent;
        }
    );

    // {{#if variable}}...{{/if}} (without else)
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
        (_match, varName, ifContent) => {
            return variables[varName] ? ifContent : '';
        }
    );

    // Variables that should NOT be escaped (contain trusted HTML/URLs)
    const rawVariables = new Set(['verificationLink', 'resetLink', 'downloadLink', 'logoUrl', 'appUrl']);

    // Replace simple variables (HTML-escaped unless in rawVariables set)
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        const safeValue = rawVariables.has(key) ? (value || '') : escapeHtml(value);
        result = result.replace(regex, safeValue);
    });
    return result;
};

// ── SMTP transporter ────────────────────────────────────────

/**
 * Create a nodemailer transporter from an SMTP config object.
 * Returns null when email delivery is not configured.
 */
export const createSmtpTransporter = (config) => {
    if (!config?.smtpHost || !config?.smtpUser || !config?.smtpPass) {
        return null;
    }

    const port = parseInt(config.smtpPort) || 587;
    const explicitSecure = typeof config.smtpSecure === 'string'
        ? config.smtpSecure.trim().toLowerCase()
        : '';
    const secure = explicitSecure
        ? explicitSecure === 'true'
        : port === 465;

    return nodemailer.createTransport({
        host: config.smtpHost,
        port,
        secure,
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass,
        },
        ...(port === 587 && { requireTLS: true }),
    });
};

// ── Send helpers ────────────────────────────────────────────

/** Direct send (used by sync path and SMTP test) */
export const sendEmail = async (to, subject, text, html, config) => {
    const transporter = createSmtpTransporter(config);

    if (!transporter) {
        logger.info('Email sent (mock mode)', summarizeEmailForLogs({ to, subject }));
        return { success: true, mock: true };
    }

    const mailOptions = {
        from: config.smtpFrom || config.smtpUser,
        to,
        subject,
        text,
        ...(html && { html }),
    };

    return transporter.sendMail(mailOptions);
};

/**
 * Send a templated email.
 *
 * @param {object} opts
 * @param {string} opts.to              – recipient address
 * @param {string} opts.templateName    – key into template map
 * @param {object} opts.variables       – template variables
 * @param {object} opts.templates       – full template map
 * @param {object} opts.smtpConfig      – SMTP config object
 * @param {boolean} opts.smtpConfigured – whether SMTP is fully configured
 * @param {string} opts.publicOrigin    – PUBLIC_ORIGIN URL
 * @param {Function} opts.getRuntimeSettingValue – fn(key, default) for branding
 * @param {object} opts.options         – { sync, priority }
 */
export const sendTemplatedEmail = async ({
    to,
    templateName,
    variables = {},
    templates,
    smtpConfig,
    smtpConfigured,
    publicOrigin,
    getRuntimeSettingValue,
    options = {},
}) => {
    const ensureAbsoluteUrl = (url) => {
        if (!url) return null;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url.split('?')[0];
        }
        return `${publicOrigin}${url.startsWith('/') ? '' : '/'}${url.split('?')[0]}`;
    };

    // Logo resolution priority
    const logoDarkEmailSetting = getRuntimeSettingValue('logoDarkEmail', '');
    const logoDarkSetting = getRuntimeSettingValue('logoDark', '');
    const logoLightEmailSetting = getRuntimeSettingValue('logoLightEmail', '');
    const logoLightSetting = getRuntimeSettingValue('logoLight', '');

    let logoUrl;
    if (logoDarkEmailSetting) {
        logoUrl = ensureAbsoluteUrl(logoDarkEmailSetting);
    } else if (logoDarkSetting) {
        logoUrl = ensureAbsoluteUrl(logoDarkSetting);
    } else if (logoLightEmailSetting) {
        logoUrl = ensureAbsoluteUrl(logoLightEmailSetting);
    } else if (logoLightSetting) {
        logoUrl = ensureAbsoluteUrl(logoLightSetting);
    } else {
        logoUrl = '';
    }

    const appVars = {
        appName: 'Sendu',
        appUrl: publicOrigin,
        logoUrl,
        ...variables,
    };

    let subject, html;

    if (!templates || !templates[templateName]) {
        subject = replaceTemplateVariables(variables.subject || 'Notificación', appVars);
        html = `<p>${replaceTemplateVariables(variables.text || '', appVars)}</p>`;
    } else {
        const template = templates[templateName];
        subject = replaceTemplateVariables(template.subject, appVars);
        html = replaceTemplateVariables(template.html, appVars);
    }

    if (!smtpConfigured) {
        logger.warn('SMTP not configured, skipping email queue', summarizeEmailForLogs({
            to,
            subject,
            templateName,
        }));
        return { queued: false, mock: true };
    }

    if (options.sync) {
        return sendEmail(to, subject, html.replace(/<[^>]*>/g, ''), html, smtpConfig);
    }

    const jobId = await enqueueEmail(to, subject, html, {
        from: smtpConfig.smtpFrom || smtpConfig.smtpUser,
        priority: options.priority,
    });

    logger.debug('Email queued', summarizeEmailForLogs({
        to,
        subject,
        templateName,
        jobId,
    }));
    return { queued: true, jobId };
};
