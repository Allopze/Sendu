const EMAIL_SEPARATOR_REGEX = /[,;]+/;

const normalizeRecipient = (value) => {
    if (!value) {
        return '';
    }

    const text = String(value).trim();
    const bracketMatch = text.match(/<([^>]+)>/);
    return (bracketMatch?.[1] || text).trim().toLowerCase();
};

const extractDomain = (value) => {
    const normalized = normalizeRecipient(value);
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex === -1 || atIndex === normalized.length - 1) {
        return 'unknown';
    }
    return normalized.slice(atIndex + 1);
};

export const summarizeEmailForLogs = ({ to, subject, ...extra } = {}) => {
    const recipients = String(to || '')
        .split(EMAIL_SEPARATOR_REGEX)
        .map((entry) => entry.trim())
        .filter(Boolean);

    const recipientDomains = [...new Set(recipients.map(extractDomain))];

    return {
        recipientCount: recipients.length,
        recipientDomains,
        subjectLength: String(subject || '').length,
        ...extra,
    };
};
