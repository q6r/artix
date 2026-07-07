//! Email service backed by Resend. Internal helpers per email type keep call
//! sites clean; in dev (no API key) emails are logged instead of sent.
//!
//! Emails use a dark, Artix-branded, table-based layout with inline styles for
//! broad client compatibility (Gmail, Apple Mail, Outlook).

use serde_json::json;

use crate::state::AppState;

pub async fn send(state: &AppState, to: &str, subject: &str, html: String) {
    if state.cfg.resend_api_key.is_empty() {
        tracing::info!(%to, %subject, "email (dev, not sent):\n{html}");
        return;
    }

    let res = state
        .http
        .post("https://api.resend.com/emails")
        .bearer_auth(&state.cfg.resend_api_key)
        .json(&json!({
            "from": state.cfg.email_from,
            "to": [to],
            "subject": subject,
            "html": html,
        }))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {}
        Ok(r) => tracing::error!(status = %r.status(), %to, "resend send failed"),
        Err(e) => tracing::error!(error = %e, %to, "resend request error"),
    }
}

/// HTML-escape a user-facing string before dropping it into a template.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

const BG: &str = "#08080a";
const CARD: &str = "#141416";
const BORDER: &str = "#26262b";
const HEADING: &str = "#ffffff";
const TEXT: &str = "#b4b4bd";
const MUTED: &str = "#6b6b76";
const PANEL: &str = "#0d0d10";

/// A high-contrast pill button (white on dark).
fn button(label: &str, url: &str) -> String {
    format!(
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:26px 0 6px\"><tr><td \
         style=\"border-radius:10px;background:#ffffff\"><a href=\"{url}\" target=\"_blank\" \
         style=\"display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\
         font-size:14px;font-weight:700;color:#0a0a0a;text-decoration:none;border-radius:10px\">{label}</a></td></tr></table>"
    )
}

/// A muted detail panel (for PIX codes, summaries, security notes).
fn panel(inner: &str) -> String {
    format!(
        "<div style=\"margin:20px 0;padding:16px 18px;background:{PANEL};border:1px solid {BORDER};\
         border-radius:12px;color:{TEXT};font-size:14px;line-height:1.6\">{inner}</div>"
    )
}

/// One label/value row inside a summary panel.
fn row(label: &str, value: &str) -> String {
    format!(
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:2px 0\"><tr>\
         <td style=\"color:{MUTED};font-size:13px;padding:3px 0\">{label}</td>\
         <td align=\"right\" style=\"color:{HEADING};font-size:13px;font-weight:600;padding:3px 0\">{value}</td>\
         </tr></table>"
    )
}

/// Full email shell: preheader + centered branded card + footer.
/// `accent` colors the thin bar at the top of the card (status cue).
fn shell(preheader: &str, accent: &str, title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">\
         <meta name=\"color-scheme\" content=\"dark\"></head>\
         <body style=\"margin:0;padding:0;background:{BG};\">\
         <span style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:{BG}\">{preheader}</span>\
         <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:{BG};padding:32px 16px\">\
         <tr><td align=\"center\">\
         <table role=\"presentation\" width=\"560\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;width:100%\">\
         <tr><td style=\"padding:4px 4px 22px\">\
           <span style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\
           font-size:17px;font-weight:800;color:#fff;letter-spacing:-0.02em\">Artix</span>\
           <span style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\
           font-size:17px;font-weight:500;color:{MUTED};letter-spacing:-0.02em\"> Cloud</span>\
         </td></tr>\
         <tr><td style=\"background:{CARD};border:1px solid {BORDER};border-radius:16px;overflow:hidden\">\
           <div style=\"height:3px;background:{accent}\"></div>\
           <div style=\"padding:30px 30px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">\
             <h1 style=\"margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:700;color:{HEADING};letter-spacing:-0.02em\">{title}</h1>\
             <div style=\"font-size:15px;line-height:1.65;color:{TEXT}\">{body}</div>\
           </div>\
         </td></tr>\
         <tr><td style=\"padding:22px 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">\
           <p style=\"margin:0;font-size:12px;line-height:1.6;color:{MUTED}\">\
           ArtixCloud — hospedagem de VPS e containers.<br>\
           Você recebeu este e-mail porque tem uma conta na ArtixCloud.</p>\
         </td></tr>\
         </table></td></tr></table></body></html>"
    )
}

const ACCENT: &str = "#ffffff";
pub const GOOD: &str = "#34d399";
pub const WARN: &str = "#fbbf24";

pub async fn send_verification(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/verify-email?token={}", state.cfg.public_app_url, token);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Bem-vindo à ArtixCloud! Falta só um passo: confirme seu e-mail para ativar a conta.</p>\
         {}\
         <p style=\"margin:16px 0 0;font-size:13px;color:{MUTED}\">Se você não criou esta conta, é só ignorar este e-mail.</p>",
        button("Confirmar e-mail", &url),
    );
    let html = shell("Confirme seu e-mail para ativar sua conta ArtixCloud", ACCENT, "Confirme seu e-mail", &body);
    send(state, to, "Confirme seu e-mail — ArtixCloud", html).await;
}

pub async fn send_login_code(state: &AppState, to: &str, code: &str) {
    let body = format!(
        "<p style=\"margin:0 0 4px\">Use o código abaixo para entrar na sua conta. Ele expira em alguns minutos.</p>\
         <div style=\"margin:22px 0;padding:20px;background:{PANEL};border:1px solid {BORDER};border-radius:12px;text-align:center\">\
           <span style=\"font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:12px;color:{HEADING}\">{code}</span>\
         </div>\
         <p style=\"margin:0;font-size:13px;color:{MUTED}\">Se não foi você que pediu este código, ignore este e-mail — sua conta segue segura.</p>",
    );
    let html = shell("Seu código de acesso ArtixCloud", ACCENT, "Seu código de acesso", &body);
    send(state, to, "Seu código de acesso — ArtixCloud", html).await;
}

pub async fn send_password_reset(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/reset-password?token={}", state.cfg.public_app_url, token);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.</p>\
         {}\
         <p style=\"margin:16px 0 0;font-size:13px;color:{MUTED}\">Se você não pediu isso, ignore este e-mail — sua senha atual continua funcionando.</p>",
        button("Redefinir senha", &url),
    );
    let html = shell("Redefina a senha da sua conta ArtixCloud", ACCENT, "Redefinir senha", &body);
    send(state, to, "Redefinir senha — ArtixCloud", html).await;
}

pub async fn send_email_change(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/confirm-email-change?token={}", state.cfg.public_app_url, token);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Confirme este endereço para concluir a troca de e-mail da sua conta ArtixCloud.</p>\
         {}\
         <p style=\"margin:16px 0 0;font-size:13px;color:{MUTED}\">Se você não solicitou esta troca, ignore este e-mail.</p>",
        button("Confirmar novo e-mail", &url),
    );
    let html = shell("Confirme seu novo endereço de e-mail", ACCENT, "Confirme seu novo e-mail", &body);
    send(state, to, "Confirme seu novo e-mail — ArtixCloud", html).await;
}

pub async fn send_security_alert(state: &AppState, to: &str, message: &str) {
    let body = format!(
        "<p style=\"margin:0 0 4px\">Detectamos uma atividade importante na sua conta:</p>{}\
         <p style=\"margin:0;font-size:13px;color:{MUTED}\">Se foi você, nenhuma ação é necessária. Caso contrário, troque sua senha imediatamente.</p>",
        panel(&format!("<strong style=\"color:{HEADING}\">{}</strong>", esc(message))),
    );
    let html = shell("Alerta de segurança da sua conta ArtixCloud", WARN, "Alerta de segurança", &body);
    send(state, to, "Alerta de segurança — ArtixCloud", html).await;
}

/// Format integer cents as a localized money string, e.g. `6990` -> `R$ 69,90`.
fn money(amount_cents: i64, currency: &str) -> String {
    let sign = if currency == "BRL" { "R$" } else { currency };
    format!("{sign} {},{:02}", amount_cents / 100, (amount_cents % 100).abs())
}

pub async fn send_invoice(
    state: &AppState,
    user: &crate::models::User,
    invoice: &crate::models::Invoice,
) {
    let url = format!(
        "{}/dashboard/billing/{}",
        state.cfg.public_app_url,
        invoice.id.unwrap_or_default().to_hex()
    );
    let summary = panel(&format!(
        "{}{}",
        row("Fatura", &esc(&invoice.number)),
        row("Valor", &money(invoice.amount_cents, &invoice.currency)),
    ));
    let pix = invoice
        .pix_code
        .as_deref()
        .map(|c| {
            format!(
                "<p style=\"margin:18px 0 8px;font-size:13px;color:{MUTED}\">Ou pague via PIX (copia e cola):</p>\
                 <div style=\"padding:14px;background:{PANEL};border:1px solid {BORDER};border-radius:10px\">\
                 <span style=\"font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;color:{TEXT};word-break:break-all;line-height:1.5\">{}</span></div>",
                esc(c)
            )
        })
        .unwrap_or_default();
    let body = format!(
        "<p style=\"margin:0 0 4px\">Sua fatura está disponível. Você pode pagar direto no painel:</p>\
         {summary}{}{pix}",
        button("Ver fatura e pagar", &url),
    );
    let html = shell("Sua fatura ArtixCloud está disponível", ACCENT, "Sua fatura", &body);
    send(state, &user.email, "Sua fatura — ArtixCloud", html).await;
}

pub async fn send_payment_confirmed(
    state: &AppState,
    user: &crate::models::User,
    invoice: &crate::models::Invoice,
) {
    let url = format!("{}/dashboard", state.cfg.public_app_url);
    let summary = panel(&format!(
        "{}{}",
        row("Fatura", &esc(&invoice.number)),
        row("Valor pago", &money(invoice.amount_cents, &invoice.currency)),
    ));
    let body = format!(
        "<p style=\"margin:0 0 4px\">Recebemos seu pagamento — obrigado! Seu serviço já está ativo e pronto para usar.</p>\
         {summary}{}",
        button("Ir para o painel", &url),
    );
    let html = shell("Pagamento confirmado — seu serviço está ativo", GOOD, "Pagamento confirmado", &body);
    send(state, &user.email, "Pagamento confirmado — ArtixCloud", html).await;
}

pub async fn send_subscription_suspended(
    state: &AppState,
    user: &crate::models::User,
    sub: &crate::models::Subscription,
) {
    let url = format!("{}/dashboard/billing", state.cfg.public_app_url);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Sua assinatura do plano <strong style=\"color:{HEADING}\">{}</strong> foi suspensa por falta de pagamento. \
         Seu serviço foi pausado e será mantido por alguns dias antes da remoção.</p>\
         <p style=\"margin:0 0 4px\">Para reativar, é só regularizar o pagamento:</p>\
         {}",
        esc(&sub.plan),
        button("Regularizar pagamento", &url),
    );
    let html = shell("Sua assinatura ArtixCloud foi suspensa", WARN, "Assinatura suspensa", &body);
    send(state, &user.email, "Assinatura suspensa — ArtixCloud", html).await;
}

// ----------------------------- Admin server notices -----------------------------

/// Default email when an admin suspends a VPS.
pub async fn send_server_suspended(state: &AppState, user: &crate::models::User, server_name: &str) {
    let url = format!("{}/dashboard", state.cfg.public_app_url);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Seu servidor <strong style=\"color:{HEADING}\">{}</strong> foi suspenso e o acesso está \
         temporariamente pausado.</p>\
         <p style=\"margin:0 0 4px\">Se você acredita que houve um engano ou quer resolver a situação, fale com o suporte ou acesse seu painel:</p>{}",
        esc(server_name),
        button("Acessar painel", &url),
    );
    let html = shell("Seu servidor ArtixCloud foi suspenso", WARN, "Servidor suspenso", &body);
    send(state, &user.email, "Servidor suspenso — ArtixCloud", html).await;
}

/// Default email when an admin reactivates a previously suspended VPS.
pub async fn send_server_reactivated(state: &AppState, user: &crate::models::User, server_name: &str) {
    let url = format!("{}/dashboard", state.cfg.public_app_url);
    let body = format!(
        "<p style=\"margin:0 0 6px\">Boas notícias: seu servidor <strong style=\"color:{HEADING}\">{}</strong> foi reativado e \
         já está disponível novamente.</p>\
         <p style=\"margin:0 0 4px\">Você pode acessá-lo pelo painel:</p>{}",
        esc(server_name),
        button("Acessar painel", &url),
    );
    let html = shell("Seu servidor ArtixCloud foi reativado", GOOD, "Servidor reativado", &body);
    send(state, &user.email, "Servidor reativado — ArtixCloud", html).await;
}

/// Admin-authored notice: `subject`/`title` are plain text; `body_markdown` is
/// rendered by the minimal Markdown renderer below. `accent` colors the top bar.
pub async fn send_admin_notice(
    state: &AppState,
    to: &str,
    subject: &str,
    title: &str,
    body_markdown: &str,
    accent: &str,
) {
    let body = md_to_html(body_markdown);
    let html = shell(&esc(subject), accent, &esc(title), &body);
    send(state, to, subject, html).await;
}

// ------------------------- Minimal, safe Markdown -> HTML -------------------------
//
// Supports `# / ## / ###` headings, `**bold**`, `*italic*`, `` `code` ``,
// `[text](url)` links (http/https/mailto only), blank-line paragraphs and
// single-newline `<br>`. Everything is HTML-escaped first and only these
// constructs are re-introduced, so raw HTML in the input stays inert. Used for
// admin-authored emails, which are otherwise untrusted free text.

/// Render an admin-authored Markdown string to email-safe HTML.
pub fn md_to_html(src: &str) -> String {
    let mut out = String::new();
    let mut para: Vec<String> = Vec::new();

    fn flush(para: &mut Vec<String>, out: &mut String) {
        if para.is_empty() {
            return;
        }
        out.push_str(&format!(
            "<p style=\"margin:0 0 14px;font-size:15px;line-height:1.65;color:{TEXT}\">{}</p>",
            para.join("<br>")
        ));
        para.clear();
    }

    for raw in src.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            flush(&mut para, &mut out);
        } else if let Some(r) = trimmed.strip_prefix("### ") {
            flush(&mut para, &mut out);
            out.push_str(&format!(
                "<h3 style=\"margin:18px 0 8px;font-size:16px;font-weight:700;color:{HEADING};line-height:1.35\">{}</h3>",
                inline_md(r)
            ));
        } else if let Some(r) = trimmed.strip_prefix("## ") {
            flush(&mut para, &mut out);
            out.push_str(&format!(
                "<h2 style=\"margin:20px 0 10px;font-size:18px;font-weight:700;color:{HEADING};line-height:1.3\">{}</h2>",
                inline_md(r)
            ));
        } else if let Some(r) = trimmed.strip_prefix("# ") {
            flush(&mut para, &mut out);
            out.push_str(&format!(
                "<h1 style=\"margin:22px 0 12px;font-size:21px;font-weight:800;color:{HEADING};line-height:1.3\">{}</h1>",
                inline_md(r)
            ));
        } else {
            para.push(inline_md(trimmed));
        }
    }
    flush(&mut para, &mut out);
    out
}

/// Only allow http/https/mailto links; neutralize anything else to `#`. The URL
/// goes into an `href="..."` attribute, so quotes/brackets are percent-encoded.
fn sanitize_url(url: &str) -> String {
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
        u.replace('&', "&amp;")
            .replace('"', "%22")
            .replace('\'', "%27")
            .replace('<', "%3C")
            .replace('>', "%3E")
            .replace(' ', "%20")
    } else {
        "#".to_string()
    }
}

/// Inline formatting for one span of text: escape, then re-introduce bold /
/// italic / code / links. Recurses into bold/italic/link bodies. UTF-8 safe —
/// all slicing happens at ASCII marker boundaries.
fn inline_md(src: &str) -> String {
    let mut out = String::new();
    let mut rest = src;
    while !rest.is_empty() {
        match rest.find(|ch| ch == '*' || ch == '`' || ch == '[') {
            None => {
                out.push_str(&esc(rest));
                break;
            }
            Some(0) => {
                if let Some((consumed, html)) = parse_construct(rest) {
                    out.push_str(&html);
                    rest = &rest[consumed..];
                } else {
                    // A lone marker that opens nothing: emit it literally.
                    let ch = rest.chars().next().unwrap();
                    out.push_str(&esc(&ch.to_string()));
                    rest = &rest[ch.len_utf8()..];
                }
            }
            Some(k) => {
                out.push_str(&esc(&rest[..k]));
                rest = &rest[k..];
            }
        }
    }
    out
}

/// Try to parse one inline construct at the start of `s`. Returns the number of
/// bytes consumed and the rendered HTML, or `None` if `s` doesn't open one.
fn parse_construct(s: &str) -> Option<(usize, String)> {
    let bytes = s.as_bytes();
    if s.starts_with("**") {
        if let Some(rel) = s[2..].find("**") {
            if rel > 0 {
                let inner = &s[2..2 + rel];
                return Some((
                    2 + rel + 2,
                    format!(
                        "<strong style=\"color:{HEADING};font-weight:700\">{}</strong>",
                        inline_md(inner)
                    ),
                ));
            }
        }
    } else if bytes[0] == b'*' {
        if let Some(rel) = s[1..].find('*') {
            if rel > 0 {
                let inner = &s[1..1 + rel];
                return Some((
                    1 + rel + 1,
                    format!("<em style=\"color:{HEADING}\">{}</em>", inline_md(inner)),
                ));
            }
        }
    } else if bytes[0] == b'`' {
        if let Some(rel) = s[1..].find('`') {
            let inner = &s[1..1 + rel];
            return Some((
                1 + rel + 1,
                format!(
                    "<code style=\"font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;\
                     background:{PANEL};border:1px solid {BORDER};padding:1px 5px;border-radius:5px;color:{HEADING}\">{}</code>",
                    esc(inner)
                ),
            ));
        }
    } else if bytes[0] == b'[' {
        if let Some(close_br) = s.find(']') {
            if s[close_br + 1..].starts_with('(') {
                if let Some(close_par_rel) = s[close_br + 2..].find(')') {
                    let text = &s[1..close_br];
                    let url = &s[close_br + 2..close_br + 2 + close_par_rel];
                    let consumed = close_br + 2 + close_par_rel + 1;
                    return Some((
                        consumed,
                        format!(
                            "<a href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\" \
                             style=\"color:{HEADING};font-weight:600;text-decoration:underline\">{}</a>",
                            sanitize_url(url),
                            inline_md(text)
                        ),
                    ));
                }
            }
        }
    }
    None
}
