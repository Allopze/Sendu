/**
 * Download Notification Email Template
 * Sent when someone downloads a shared file
 */

import { wrapInBaseTemplate } from './baseStyles';

const content = `
    <h2>¡Tu archivo fue descargado!</h2>
    <p>Hola {{username}},</p>
    <p>Alguien ha descargado tu archivo compartido:</p>
    <div class="info-box">
        <p><strong>Archivo:</strong> {{fileName}}<br>
        <strong>Tamaño:</strong> {{fileSize}}</p>
    </div>
`;

export const downloadNotificationTemplate = {
    name: 'Notificación de Descarga',
    subject: 'Tu archivo fue descargado - {{appName}}',
    html: wrapInBaseTemplate(content)
};

export default downloadNotificationTemplate;
