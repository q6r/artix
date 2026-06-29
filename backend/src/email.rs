//! Email service backed by Resend. Internal helpers per email type keep call
//! sites clean; in dev (no API key) emails are logged instead of sent.

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

fn layout(title: &str, body: &str) -> String {
    format!(
        "<div style=\"font-family:sans-serif;background:#0a0a0a;color:#fff;padding:32px\">\
         <h2>{title}</h2><div style=\"color:#cfcfcf;line-height:1.6\">{body}</div>\
         <p style=\"color:#777;margin-top:24px;font-size:12px\">ArtixCloud</p></div>"
    )
}

pub async fn send_verification(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/verify-email?token={}", state.cfg.public_app_url, token);
    let html = layout(
        "Confirme seu e-mail",
        &format!("<p>Confirme seu e-mail para ativar a conta.</p><p><a href=\"{url}\">Confirmar e-mail</a></p>"),
    );
    send(state, to, "Confirme seu e-mail — ArtixCloud", html).await;
}

pub async fn send_login_code(state: &AppState, to: &str, code: &str) {
    let html = layout(
        "Seu código de acesso",
        &format!(
            "<p>Use o código abaixo para entrar na ArtixCloud. Ele expira em alguns minutos.</p>\
             <p style=\"font-size:30px;font-weight:700;letter-spacing:8px;background:#161616;\
             padding:14px 18px;border-radius:10px;display:inline-block;color:#fff\">{code}</p>\
             <p>Se não foi você que pediu, ignore este e-mail.</p>"
        ),
    );
    send(state, to, "Seu código de acesso — ArtixCloud", html).await;
}

pub async fn send_password_reset(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/reset-password?token={}", state.cfg.public_app_url, token);
    let html = layout(
        "Redefinir senha",
        &format!("<p>Recebemos um pedido para redefinir sua senha.</p><p><a href=\"{url}\">Redefinir senha</a></p><p>Se não foi você, ignore este e-mail.</p>"),
    );
    send(state, to, "Redefinir senha — ArtixCloud", html).await;
}

pub async fn send_email_change(state: &AppState, to: &str, token: &str) {
    let url = format!("{}/confirm-email-change?token={}", state.cfg.public_app_url, token);
    let html = layout(
        "Confirme seu novo e-mail",
        &format!("<p>Confirme este endereço para concluir a troca de e-mail.</p><p><a href=\"{url}\">Confirmar novo e-mail</a></p>"),
    );
    send(state, to, "Confirme seu novo e-mail — ArtixCloud", html).await;
}

pub async fn send_security_alert(state: &AppState, to: &str, message: &str) {
    let html = layout("Alerta de segurança", &format!("<p>{message}</p>"));
    send(state, to, "Alerta de segurança — ArtixCloud", html).await;
}

/// Format integer cents as a localized money string, e.g. `BRL 6.990` -> `R$ 69,90`.
fn money(amount_cents: i64, currency: &str) -> String {
    let sign = if currency == "BRL" { "R$" } else { currency };
    format!("{sign} {},{:02}", amount_cents / 100, (amount_cents % 100).abs())
}

pub async fn send_invoice(
    state: &AppState,
    user: &crate::models::User,
    invoice: &crate::models::Invoice,
) {
    let url = format!("{}/dashboard/billing/{}", state.cfg.public_app_url, invoice.id.unwrap_or_default().to_hex());
    let pix = invoice
        .pix_code
        .as_deref()
        .map(|c| format!(
            "<p>Pague via PIX (copia e cola):</p>\
             <pre style=\"white-space:pre-wrap;word-break:break-all;background:#161616;padding:12px;border-radius:8px\">{c}</pre>"
        ))
        .unwrap_or_default();
    let body = format!(
        "<p>Fatura <strong>{}</strong> — {}.</p>{pix}\
         <p><a href=\"{url}\">Ver fatura no painel</a></p>",
        invoice.number,
        money(invoice.amount_cents, &invoice.currency),
    );
    let html = layout("Sua fatura ArtixCloud", &body);
    send(state, &user.email, "Fatura ArtixCloud — pagamento via PIX", html).await;
}

pub async fn send_payment_confirmed(
    state: &AppState,
    user: &crate::models::User,
    invoice: &crate::models::Invoice,
) {
    let body = format!(
        "<p>Recebemos o pagamento da fatura <strong>{}</strong> ({}). Sua VPS está ativa.</p>",
        invoice.number,
        money(invoice.amount_cents, &invoice.currency),
    );
    let html = layout("Pagamento confirmado", &body);
    send(state, &user.email, "Pagamento confirmado — ArtixCloud", html).await;
}

pub async fn send_subscription_suspended(
    state: &AppState,
    user: &crate::models::User,
    sub: &crate::models::Subscription,
) {
    let url = format!("{}/dashboard/billing", state.cfg.public_app_url);
    let body = format!(
        "<p>Sua assinatura do plano <strong>{}</strong> foi suspensa por falta de pagamento. \
         Sua VPS foi desligada e será mantida por alguns dias.</p>\
         <p><a href=\"{url}\">Regularizar pagamento</a></p>",
        sub.plan,
    );
    let html = layout("Assinatura suspensa", &body);
    send(state, &user.email, "Assinatura suspensa — ArtixCloud", html).await;
}
