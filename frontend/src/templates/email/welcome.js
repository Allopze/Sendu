/**
 * Welcome Email Template
 * Sent when a new user registers
 */

import { wrapInBaseTemplate } from './baseStyles';

const content = `
    <h2>Hola {{username}},</h2>
    <p>Gracias por registrarte en {{appName}}. Tu cuenta ha sido creada exitosamente.</p>
    <p>Por favor verifica tu email haciendo clic en el siguiente botón:</p>
    <p style="text-align: center;">
        <a href="{{verificationLink}}" class="button">Verificar Email</a>
    </p>
    <p>Si no creaste esta cuenta, puedes ignorar este mensaje.</p>
`;

export const welcomeTemplate = {
    name: 'Bienvenida',
    subject: 'Bienvenido a {{appName}}',
    html: wrapInBaseTemplate(content)
};

export default welcomeTemplate;
