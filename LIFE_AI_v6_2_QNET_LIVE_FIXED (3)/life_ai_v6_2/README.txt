LIFE AI v6 — 실데이터 베타

연결 대상
1) 고용24 채용정보 API
   - 실제 회사명, 채용제목, 등록일, 마감일, 지역 등을 가져옵니다.
   - Netlify 환경변수: WORK24_AUTH_KEY

2) 한국산업인력공단 Q-Net 국가자격
   - 국가자격 종목목록에서 사용자가 입력한 자격명을 종목코드로 찾습니다.
   - 국가자격 시험일정 API에서 실제 원서접수/시험/합격발표 일정을 조회합니다.
   - Netlify 환경변수: DATA_GO_KR_SERVICE_KEY

중요
- 인증키를 index.html에 직접 넣지 마세요. 친구에게 링크를 공유하면 노출됩니다.
- 반드시 Netlify 환경변수에 넣습니다.
- 고용24 OPEN API는 기업회원 전용이며 신청/심사 후 인증키가 발급됩니다.
- 공공데이터포털 Q-Net 시험일정은 활용신청 후 인증키가 필요합니다.
- 공식 데이터라도 변경될 수 있으므로 LIFE AI 화면에서 원문 확인 안내를 유지해야 합니다.

Netlify 배포
1. 이 폴더 전체를 Git 저장소 또는 Netlify 배포 대상으로 사용
2. Netlify > Site configuration > Environment variables
3. WORK24_AUTH_KEY, DATA_GO_KR_SERVICE_KEY 등록
4. 새 Deploy 실행
5. 앱에서 취업 목표 → 채용 상세 → '실제 공고 불러오기'
6. 자격증 목표 → 자격증 화면 → '실제 일정 불러오기'

주의: Netlify Drop의 단순 정적 폴더 업로드 방식에서는 Functions 배포가 제한될 수 있습니다.
가장 안정적인 방식은 GitHub 저장소와 Netlify를 연결하여 배포하는 것입니다.

v6.1 Q-Net 수정사항
- 공공데이터포털 화면의 URL 인코딩된 일반 인증키를 환경변수에 그대로 넣어도 되도록 1회 디코딩 처리
- 국가자격 종목 목록 공식 응답 태그(jmcd, jmfldnm, qualgbcd, qualgbnm) 반영
- 국가자격 종목 목록 API 활용신청이 별도로 필요함
- Q-Net 시험일정 공식 HTTPS 요청주소 사용
- API 오류 메시지 표시 개선

필수 활용신청 2개
1. 한국산업인력공단_국가자격 시험일정 조회 서비스
2. 한국산업인력공단_국가자격 종목 목록 정보


v6.2 핵심 수정
- Q-Net 시험일정 JSON 응답에서 body.items를 직접 배열로 읽도록 수정
- 과거/다른 형식의 body.items.item 구조도 호환
- totalCount 진단값 추가
- 인증키/종목코드 변환은 v6.1 방식 유지

정상 테스트 예:
https://<내사이트>.netlify.app/.netlify/functions/qnet-schedule?name=전기기사&year=2026

정상 시 qualification.name = 전기기사, totalCount > 0, items 안에 2026년 회차별 일정이 표시됩니다.
