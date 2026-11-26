/**
 * 12월 2일 체험판의 설정(PLAN 7.9). 글자 값이라 튜닝 패널과 공유 링크에는 넣지 않는다.
 */
export const DEMO = {
  /** "체험판 끝" 화면의 피드백 설문 주소. 자리값이고, 비어 있으면 설문 단추를 숨긴다. */
  surveyUrl: '',
};

/** 설문 단추의 주소와, 누르기 전에 보여 줄 짧은 주소(호스트와 경로) */
export interface SurveyLink {
  href: string;
  shown: string;
}

/** 설문 주소를 읽는다. 비었거나 http, https 주소가 아니면 null이고, 그때는 단추를 숨긴다. */
export function surveyLink(url: string): SurveyLink | null {
  const text = url.trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { href: parsed.href, shown: `${parsed.host}${parsed.pathname}`.replace(/\/$/, '') };
  } catch {
    return null;
  }
}
