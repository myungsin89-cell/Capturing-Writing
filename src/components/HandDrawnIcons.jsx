import React from 'react';

/**
 * [로고 시안 1] 『다정한 손길(쓰다듬다) 위에 담긴 연필과 새싹』
 * - 아래쪽의 포근한 초승달 손길이 아이의 마음을 '쓰담쓰담' 감싸 안고,
 * - 그 위에서 연필이 지나가며 싱그러운 초록 새싹과 따뜻한 온기가 피어나는 핸드드로운 심볼
 */
export function SseudamLogoOption1({ size = 44, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      className={`shrink-0 ${className}`}
    >
      {/* 배경 포근한 원형 오라 */}
      <circle
        cx="28"
        cy="28"
        r="25"
        fill="#F2F9F5"
        stroke="#B7E4C7"
        strokeWidth="1.6"
      />

      {/* 연필 끝에서 피어나는 초록 새싹 (성장) */}
      <path
        d="M22 29V18"
        stroke="#1B4332"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* 왼쪽 잎사귀 */}
      <path
        d="M22 21C16.5 21 13 17.5 13 12.5C18 12.5 22 15.5 22 21Z"
        fill="#52B788"
        stroke="#122E22"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* 오른쪽 작은 잎사귀 */}
      <path
        d="M22 19C26.5 19 29.5 16 29.5 11.5C25 11.5 22 14.5 22 19Z"
        fill="#95D5B2"
        stroke="#122E22"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      {/* 다정하게 글을 쓰는 연필 (오른쪽 위에서 가운데로) */}
      <g transform="rotate(38 35 22)">
        <rect
          x="31.5"
          y="8"
          width="7.5"
          height="19"
          rx="2"
          fill="#FBFBF9"
          stroke="#122E22"
          strokeWidth="1.9"
        />
        <rect
          x="31.5"
          y="8"
          width="7.5"
          height="4.5"
          rx="1.5"
          fill="#F59E0B"
          stroke="#122E22"
          strokeWidth="1.8"
        />
        <path
          d="M31.5 27L35.25 33.5L39 27H31.5Z"
          fill="#FDE68A"
          stroke="#122E22"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path d="M33.8 31L35.25 33.5L36.7 31H33.8Z" fill="#122E22" />
      </g>

      {/* 아래에서 모든 것을 다정하게 감싸 안고 쓰다듬는 손길/보울 곡선 */}
      <path
        d="M9 32.5C10.5 42.5 18.5 47.5 28.5 47.5C38 47.5 45.5 42.5 47 33.5C42.5 36.8 36 38.5 28.5 38.5C20.5 38.5 14 36.2 9 32.5Z"
        fill="#1B4332"
        stroke="#122E22"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 손길 안쪽의 다정한 민트빛 물결 라인 */}
      <path
        d="M15.5 41.2C20 43.8 25.5 44.5 31.5 43.8"
        stroke="#74C69D"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* 다정한 온기 반짝임 포인트 */}
      <path
        d="M41 13.5L42 16L44.5 17L42 18L41 20.5L40 18L37.5 17L40 16L41 13.5Z"
        fill="#F59E0B"
      />
    </svg>
  );
}

/**
 * [로고 시안 3] 『온기가 피어오르는 다정한 그릇(담다)에 담긴 글과 연필』
 * - '쓴 걸 담다(쓰담)'라는 어원 그대로, 포근하게 눈웃음 짓는 도자기 그릇 안에
 *   아이의 편지지(원고지)와 연필, 새싹이 소복이 담겨 있는 아기자기한 심볼
 */
export function SseudamLogoOption3({ size = 44, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      className={`shrink-0 ${className}`}
    >
      {/* 그릇 속에 쏙 담긴 편지지(쓴 글) */}
      <g transform="rotate(-6 25 20)">
        <rect
          x="13"
          y="9"
          width="22"
          height="22"
          rx="3"
          fill="#FBFBF9"
          stroke="#122E22"
          strokeWidth="1.9"
        />
        <line
          x1="17"
          y1="14.5"
          x2="30"
          y2="14.5"
          stroke="#52B788"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <line
          x1="17"
          y1="19"
          x2="27"
          y2="19"
          stroke="#95D5B2"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </g>

      {/* 그릇 오른쪽에 비스듬히 꽂힌 다정한 연필 */}
      <g transform="rotate(24 38 19)">
        <rect
          x="34.5"
          y="7"
          width="6.8"
          height="20"
          rx="2"
          fill="#FEF3C7"
          stroke="#122E22"
          strokeWidth="1.9"
        />
        <rect
          x="34.5"
          y="7"
          width="6.8"
          height="4.5"
          rx="1.5"
          fill="#52B788"
          stroke="#122E22"
          strokeWidth="1.8"
        />
      </g>

      {/* 왼쪽 위로 피어나는 작은 초록 새싹 온기 */}
      <path
        d="M12 19C9 17 8.5 13 11 11C13.5 13 14 16.5 12 19Z"
        fill="#52B788"
        stroke="#122E22"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />

      {/* 쓴 글을 포근하게 담아내는 다정한 초록 그릇(Bowl) */}
      <path
        d="M8 26H48L45.2 38.5C43.8 44.5 38.5 48.5 32.2 48.5H23.8C17.5 48.5 12.2 44.5 10.8 38.5L8 26Z"
        fill="#1B4332"
        stroke="#122E22"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* 그릇 상단 테두리 림(Rim) */}
      <rect
        x="6.5"
        y="23.5"
        width="43"
        height="4.5"
        rx="2.25"
        fill="#52B788"
        stroke="#122E22"
        strokeWidth="1.9"
      />

      {/* 그릇의 다정한 눈웃음(^^)과 볼터치 ('다정하게 봐줘요' 감성) */}
      <path
        d="M19.5 35.5C20.5 34 22.2 34 23.2 35.5"
        stroke="#FBFBF9"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M32.8 35.5C33.8 34 35.5 34 36.5 35.5"
        stroke="#FBFBF9"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="17.5" cy="38" r="1.8" fill="#74C69D" />
      <circle cx="38.5" cy="38" r="1.8" fill="#74C69D" />
      <path
        d="M25.2 38.2C26.8 40.2 29.2 40.2 30.8 38.2"
        stroke="#FBFBF9"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 다정한 글쓰기 '쓰담' 공식 시그니처 로고 (다정한 손길 위에 담긴 연필과 새싹)
export function HandDrawnNotebookLogo({ size = 44, className = '' }) {
  return <SseudamLogoOption1 size={size} className={className} />;
}

// 2. 선형 새싹(초록덕후) 아이콘
export function HandDrawnLeafIcon({ size = 18, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M12 21V11M12 11C12 7 15.5 4 20 4C20 8.5 17 12 12 12M12 14C12 10.5 9 8 5 8C5 12 8 14.5 12 14Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 3. 선형 손그림 연필(글쓰기) 아이콘
export function HandDrawnPencilIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M16.5 3.8C17.3 3 18.6 3 19.4 3.8L20.2 4.6C21 5.4 21 6.7 20.2 7.5L8.3 19.4L3.5 20.5L4.6 15.7L16.5 3.8Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 5.8L18.2 9.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 20.5H20.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

// 4. 선형 손그림 성장 비교(Diff / 변화 과정) 아이콘
export function HandDrawnDiffIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="4" width="8" height="16" rx="2" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="13" y="4" width="8" height="16" rx="2" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5.5 8.5H8.5M5.5 12H7.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.5 8.5H18.5M15.5 12H18.5M15.5 15.5H17.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.5 15L14.5 15M14.5 15L12.8 13.3M14.5 15L12.8 16.7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 5. 선형 손그림 질문/댓글 말풍선 아이콘
export function HandDrawnChatIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M4 6.5C4 5.1 5.1 4 6.5 4H17.5C18.9 4 20 5.1 20 6.5V14.5C20 15.9 18.9 17 17.5 17H9.5L5 20.5V17C4.4 16.5 4 15.6 4 14.5V6.5Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 9.2H16M8 12.5H13" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// 6. 선형 손그림 브리스크(AI 피드백 반짝임) 아이콘
export function HandDrawnSparkleIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M12 3L14.2 8.8L20 11L14.2 13.2L12 19L9.8 13.2L4 11L9.8 8.8L12 3Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19 16.5V20.5M17 18.5H21" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// 7. 선형 손그림 구글 독스 문서 아이콘
export function HandDrawnDocIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M6 3.5H14.5L19 8V19.5C19 20.3 18.3 21 17.5 21H6.5C5.7 21 5 20.3 5 19.5V4.5C5 3.9 5.5 3.5 6 3.5Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V8.5H19" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 12H15.5M8.5 15.2H15.5M8.5 18.2H12.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// 8. 선형 손그림 자물쇠(제출 마감/편집 잠금) 아이콘
export function HandDrawnLockIcon({ size = 18, locked = true, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
      {locked ? (
        <path d="M8 10.5V7.5C8 5.3 9.8 3.5 12 3.5C14.2 3.5 16 5.3 16 7.5V10.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      ) : (
        <path d="M8 10.5V7.5C8 5.3 9.8 3.5 12 3.5C13.8 3.5 15.3 4.7 15.8 6.3" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      )}
      <circle cx="12" cy="15.5" r="1.4" fill={color} />
    </svg>
  );
}

// 9. 선형 손그림 체크 원형 아이콘
export function HandDrawnCheckIcon({ size = 18, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.9" />
      <path d="M8.5 12.3L10.9 14.7L15.8 9.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 10. 선형 손그림 단계 화살표 아이콘
export function HandDrawnArrowRightIcon({ size = 16, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path d="M5 12H19M19 12L13.5 6.5M19 12L13.5 17.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
