<#--
  Neural Frontier login layout. Same macro contract as Keycloak's base template.ftl
  (registrationLayout + nested header / show-username / form / socialProviders / info),
  so every built-in page body renders inside it unchanged.
-->
<#import "footer.ftl" as loginFooter>
<#import "theme-resources.ftl" as themeResourceTags>
<#macro logo size="32">
<svg class="nf-logo" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Neural Frontier">
  <defs><linearGradient id="nf-logo-g-${size}" x1="2" y1="30" x2="30" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#5fd0e6"/></linearGradient></defs>
  <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#nf-logo-g-${size})"/>
  <path d="M6 23.5c3.2-2.6 6.6-3.9 10-3.9s6.8 1.3 10 3.9" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M8.5 18.5 14 10l3.6 5.2L23.5 8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="8.5" cy="18.5" r="2" fill="#fff"/><circle cx="14" cy="10" r="2" fill="#fff"/><circle cx="17.6" cy="15.2" r="1.6" fill="#fff" fill-opacity=".85"/><circle cx="23.5" cy="8" r="2.4" fill="#fff"/>
</svg>
</#macro>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<#assign nfPage = pageId!"login">
<#assign nfSetupStep = 0>
<#if nfPage == "login-update-password" && !(isAppInitiatedAction??)><#assign nfSetupStep = 1></#if>
<#if nfPage == "login-config-totp" && !(isAppInitiatedAction??)><#assign nfSetupStep = 2></#if>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">
    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${title!} · Neural Frontier</title>
    <link rel="icon" type="image/svg+xml" href="${url.resourcesPath}/img/favicon.svg" />
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript" defer></script>
        </#list>
    </#if>
    <script type="importmap">
        { "imports": { "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js" } }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        <#outputformat "JavaScript">
        import { startSessionPolling } from ${(url.resourcesPath + "/js/authChecker.js")?c};
        startSessionPolling(${url.ssoLoginInOtherTabsUrl?c});
        </#outputformat>
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");
            if (!link) return;
            if (link.getAttribute("aria-disabled") === "true") { event.preventDefault(); return; }
            const { disabledClass } = link.dataset;
            if (disabledClass) link.classList.add(...disabledClass.trim().split(/\s+/));
            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            <#outputformat "JavaScript">
            import { checkAuthSession } from ${(url.resourcesPath + "/js/authChecker.js")?c};
            checkAuthSession(${authenticationSession.authSessionIdHash?c});
            </#outputformat>
        </script>
    </#if>
</head>

<body class="${properties.kcBodyClass!} ${bodyClass}" data-page-id="login-${nfPage}"
      data-msg-copy="${msg('nfCopy')}" data-msg-copied="${msg('nfCopied')}" data-msg-caps="${msg('nfCapsLock')}"
      data-msg-signing="${msg('nfSigningIn')}" data-msg-strength="${msg('nfStrength')}"
      data-msg-strengths="${msg('nfStrength0')}|${msg('nfStrength1')}|${msg('nfStrength2')}|${msg('nfStrength3')}|${msg('nfStrength4')}"
      data-msg-rule-length="${msg('nfRuleLength')}" data-msg-rule-identity="${msg('nfRuleIdentity')}"
      data-msg-rule-match="${msg('nfRuleMatch')}" data-user="${(auth.attemptedUsername)!''}">
<div class="${properties.kcLoginClass!}">

    <#-- Brand panel: decorative, hidden from assistive technology except the text. -->
    <aside class="nf-brand">
        <div class="nf-aurora" aria-hidden="true"><span class="nf-aurora-a"></span><span class="nf-aurora-b"></span><span class="nf-grid"></span></div>
        <svg class="nf-horizon" aria-hidden="true" viewBox="0 0 800 520" preserveAspectRatio="xMidYMax slice">
            <defs><linearGradient id="nf-ridge" x1="0" x2="1"><stop offset="0" stop-color="#7c6cff" stop-opacity="0"/><stop offset=".5" stop-color="#7c6cff" stop-opacity=".7"/><stop offset="1" stop-color="#5fd0e6" stop-opacity=".15"/></linearGradient></defs>
            <path d="M0 300 L114 252 L229 228 L343 236 L457 271 L571 312 L686 334 L800 330" fill="none" stroke="url(#nf-ridge)" stroke-width="1.2"/>
            <path d="M0 330 L100 300 L200 268 L300 252 L400 262 L500 296 L600 330 L700 350 L800 344" fill="none" stroke="url(#nf-ridge)" stroke-width="1.2"/>
            <path d="M0 380 L80 352 L160 318 L240 292 L320 280 L400 286 L480 310 L560 342 L640 370 L720 384 L800 378" fill="none" stroke="url(#nf-ridge)" stroke-width="1.2"/>
            <g class="nf-nodes">
                <circle cx="114" cy="252" r="3"/><circle cx="343" cy="236" r="2"/><circle cx="571" cy="312" r="3"/><circle cx="800" cy="330" r="2"/>
                <circle cx="200" cy="268" r="2"/><circle cx="400" cy="262" r="3"/><circle cx="600" cy="330" r="2"/>
                <circle cx="160" cy="318" r="3"/><circle cx="320" cy="280" r="2"/><circle cx="480" cy="310" r="3"/><circle cx="640" cy="370" r="2"/>
            </g>
        </svg>
        <div class="nf-brand-inner">
            <div class="nf-wordmark"><@logo size="36"/><span><strong>Neural Frontier</strong><small>Identity</small></span></div>
            <div class="nf-brand-copy">
                <p class="nf-eyebrow">${msg("nfEyebrow")}</p>
                <h2 class="nf-tagline"><span class="nf-gradient-text">${msg("nfTagline")}</span><br>${msg("nfTaglineSub")}</h2>
                <p class="nf-intro">${msg("nfBrandIntro")}</p>
                <ul class="nf-features">
                    <li><span class="nf-feature-icon"><i class="nf-i nf-i-shield" aria-hidden="true"></i></span><span><strong>${msg("nfFeature1Title")}</strong>${msg("nfFeature1Text")}</span></li>
                    <li><span class="nf-feature-icon"><i class="nf-i nf-i-phone" aria-hidden="true"></i></span><span><strong>${msg("nfFeature2Title")}</strong>${msg("nfFeature2Text")}</span></li>
                    <li><span class="nf-feature-icon"><i class="nf-i nf-i-list" aria-hidden="true"></i></span><span><strong>${msg("nfFeature3Title")}</strong>${msg("nfFeature3Text")}</span></li>
                </ul>
            </div>
            <p class="nf-brand-foot">© Neural Frontier</p>
        </div>
    </aside>

    <main class="nf-main">
        <div class="nf-main-glow" aria-hidden="true"></div>
        <div class="${properties.kcFormCardClass!}">
            <div class="nf-card-top">
                <div class="nf-wordmark nf-wordmark-compact"><@logo size="28"/><span><strong>Neural Frontier</strong></span></div>
                <span class="nf-chip nf-chip-context">${msg("nfContext")}</span>
                <#if realm.internationalizationEnabled && locale.supported?size gt 1>
                    <div class="nf-locale" id="kc-locale">
                        <div id="kc-locale-dropdown" class="menu-button-links">
                            <button tabindex="1" id="kc-current-locale-link" class="nf-chip" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1"><i class="nf-i nf-i-globe" aria-hidden="true"></i>${locale.current}</button>
                            <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="nf-menu">
                                <#assign i = 1>
                                <#list locale.supported as l>
                                    <li role="none"><a role="menuitem" id="language-${i}" href="${l.url}">${l.label}</a></li>
                                    <#assign i++>
                                </#list>
                            </ul>
                        </div>
                    </div>
                <#else>
                    <span class="nf-chip nf-chip-secure"><i class="nf-i nf-i-lock" aria-hidden="true"></i>Secure</span>
                </#if>
            </div>

            <#if nfSetupStep gt 0>
                <ol class="nf-steps" aria-label="${msg('nfSetupTitle')}">
                    <li class="<#if nfSetupStep gt 1>is-done<#else>is-current</#if>"><span class="nf-step-dot">1</span>${msg("nfStepPassword")}</li>
                    <li class="<#if nfSetupStep == 2>is-current</#if>"><span class="nf-step-dot">2</span>${msg("nfStepAuthenticator")}</li>
                    <li><span class="nf-step-dot">3</span>${msg("nfStepDone")}</li>
                </ol>
            </#if>

            <header class="${properties.kcFormHeaderClass!}">
                <h1 id="kc-page-title"><#nested "header"></h1>
                <#assign nfSubKey = "nfSubtitle." + nfPage>
                <#if msg(nfSubKey) != nfSubKey><p class="nf-subtitle">${msg(nfSubKey)}</p></#if>
                <#if displayRequiredFields>
                    <p class="nf-required-note"><span class="required">*</span> ${msg("requiredFields")}</p>
                </#if>
                <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
                    <#nested "show-username">
                    <div id="kc-username" class="nf-identity">
                        <span class="nf-identity-avatar" aria-hidden="true"><#if (auth.attemptedUsername!"")?has_content>${auth.attemptedUsername?substring(0,1)?upper_case}<#else>?</#if></span>
                        <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                        <a id="reset-login" href="${url.loginRestartFlowUrl}" class="nf-identity-switch" aria-label="${msg("restartLoginTooltip")}">
                            <i class="${properties.kcResetFlowIcon!}" aria-hidden="true"></i><span>${msg("restartLoginTooltip")}</span>
                        </a>
                    </div>
                </#if>
            </header>

            <div id="kc-content">
                <div id="kc-content-wrapper">
                    <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                        <div class="${properties.kcAlertClass!} nf-alert-${message.type}" role="<#if message.type = 'error'>alert<#else>status</#if>">
                            <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}" aria-hidden="true"></span></#if>
                            <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}" aria-hidden="true"></span></#if>
                            <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}" aria-hidden="true"></span></#if>
                            <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}" aria-hidden="true"></span></#if>
                            <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                        </div>
                    </#if>

                    <#nested "form">

                    <#if auth?has_content && auth.showTryAnotherWayLink()>
                        <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post" class="nf-alt-way">
                            <input type="hidden" name="tryAnotherWay" value="on"/>
                            <a href="#" id="try-another-way" onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                        </form>
                    </#if>

                    <#if switchOrganizationEnabled?? && switchOrganizationEnabled>
                        <form id="kc-switch-organization-form" action="${url.loginAction}" method="post" class="nf-alt-way">
                            <input type="hidden" name="switchOrganization" value="true"/>
                            <a href="#" id="switch-organization" onclick="document.forms['kc-switch-organization-form'].requestSubmit();return false;">${msg("doSwitchOrganization")}</a>
                        </form>
                    </#if>

                    <#nested "socialProviders">

                    <#if displayInfo>
                        <div id="kc-info" class="${properties.kcSignUpClass!}">
                            <div id="kc-info-wrapper"><#nested "info"></div>
                        </div>
                    </#if>
                </div>
            </div>

            <footer class="nf-card-foot">
                <span><i class="nf-i nf-i-lock" aria-hidden="true"></i>${msg("nfSecureFooter")}</span>
                <span class="nf-realm-tag">${realm.name}</span>
            </footer>
            <@loginFooter.content/>
        </div>
    </main>
</div>
</body>
</html>
</#macro>
