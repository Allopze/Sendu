/**
 * Email Verification Template
 * Sent when admin requests email verification for a user
 */

import { wrapInBaseTemplate } from './baseStyles.js';

const content = `
    <h2>Verificación de Email</h2>
    <p>Hola {{username}},</p>
    <p>Se ha solicitado la verificación de tu dirección de correo electrónico para tu cuenta en {{appName}}.</p>
    <p>Haz clic en el siguiente botón para verificar tu email:</p>
    <p style="text-align: center;">
        <a href="{{verificationLink}}" class="button">Verificar Email</a>
    </p>
    <p>Si no solicitaste esta verificación, puedes ignorar este mensaje.</p>
`;

export const verificationTemplate = {
    name: 'Verificación de Email',
    subject: 'Verifica tu email - {{appName}}',
    html: wrapInBaseTemplate(content)
};

export default verificationTemplate;
