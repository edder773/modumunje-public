/** Analytics quality filter only; never use a User-Agent to authorize requests. */
export function automatedAnalyticsAgent(userAgent: string, webdriver = false) {
  return webdriver || /HeadlessChrome|bot|crawler|spider|Lighthouse|PageSpeed/iu.test(userAgent);
}
