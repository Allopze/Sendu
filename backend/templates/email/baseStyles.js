/**
 * Base email styles - Shared across all templates
 */

export const baseStyles = `
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #121212; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .header img { max-height: 100px; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #fd3f31; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 20px; }
    .info-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
`;

export const wrapInBaseTemplate = (content) => `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${baseStyles}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            {{#if logoUrl}}<img src="{{logoUrl}}" alt="{{appName}}" />{{else}}<h1 style="margin: 0; font-size: 24px;">{{appName}}</h1>{{/if}}
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>{{appName}} - <a href="{{appUrl}}" style="color: #fd3f31;">{{appUrl}}</a></p>
        </div>
    </div>
</body>
</html>`;

export default baseStyles;
