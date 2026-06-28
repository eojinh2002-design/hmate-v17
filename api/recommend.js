import fs from "fs";
import path from "path";
import OpenAI from "openai";

const facilities = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "facilities.json"), "utf-8"));
const areaGroups = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "areaGroups.json"), "utf-8"));
const districtCoords = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "districtCoords.json"), "utf-8"));
const adjacentGroups = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "adjacentGroups.json"), "utf-8"));

function unique(arr){ return [...new Set(arr.filter(Boolean))]; }
function getAreaGroup(district){
  for(const [group, ds] of Object.entries(areaGroups)){
    if(ds.includes(district)) return group;
  }
  return "화성시";
}
function calcDistanceKm(lat1,lng1,lat2,lng2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getLocationMeta(f, userContext={}){
  const area = getAreaGroup(f.district);
  if(userContext.mode === "district" && userContext.selectedAreaGroup){
    if(area === userContext.selectedAreaGroup) return { type:"sameArea", label:"선택 권역과 가까움", detail:`${userContext.selectedAreaGroup} 내 시설` };
    if(adjacentGroups[userContext.selectedAreaGroup]?.includes(area)) return { type:"nearArea", label:"인접 권역", detail:`${userContext.selectedAreaGroup} 인근 ${area}` };
    return { type:"none", label:"화성시 시설", detail:"선택 권역 외 시설" };
  }
  if(userContext.mode === "gps" && userContext.lat && userContext.lng && districtCoords[f.district]){
    const c = districtCoords[f.district];
    const km = calcDistanceKm(userContext.lat, userContext.lng, c.lat, c.lng);
    if(km <= 3) return { type:"gpsVeryNear", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치와 매우 가까운 권역", distanceKm: Number(km.toFixed(1)) };
    if(km <= 7) return { type:"gpsNear", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치 기준 가까운 시설", distanceKm: Number(km.toFixed(1)) };
    if(km <= 13) return { type:"gpsMid", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치 기준 접근 가능", distanceKm: Number(km.toFixed(1)) };
    if(km <= 24) return { type:"gpsFar", label:`약 ${km.toFixed(1)}km`, detail:"화성시 내 이동권 시설", distanceKm: Number(km.toFixed(1)) };
    return { type:"none", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치와 거리가 있는 시설", distanceKm: Number(km.toFixed(1)) };
  }
  return { type:"none", label:"위치 기준 없음", detail:"목적 중심 추천" };
}
function locationScore(f,userContext){
  const meta = getLocationMeta(f,userContext);
  if(meta.type === "sameArea") return 44;
  if(meta.type === "nearArea") return 18;
  if(meta.type === "gpsVeryNear") return 55;
  if(meta.type === "gpsNear") return 38;
  if(meta.type === "gpsMid") return 22;
  if(meta.type === "gpsFar") return 8;
  return 0;
}
function analyzeQuery(query){
  const q = String(query || "").replace(/\s/g,"");
  const categories = [];
  const tokens = [];
  const districts = [];
  const rules = [
    {words:["축구","풋살","운동","체육","농구","배드민턴","수영"], cats:["체육시설","공원시설","물놀이장"], tokens:["축구","풋살","운동","체육","체육관","수영"]},
    {words:["마트","장보기","쇼핑"], cats:["주요시설"], tokens:["마트","장보기","쇼핑","대형마트"]},
    {words:["도서관","공부","스터디","책","조용"], cats:["도서관","문화시설"], tokens:["도서관","공부","스터디","책","열람실"]},
    {words:["아이","가족","어린이","유아"], cats:["어린이공원","공원시설","도서관","문화시설","물놀이장"], tokens:["아이","가족","어린이","유아","놀이터"]},
    {words:["공원","산책","걷기","자연","맨발"], cats:["공원시설","어린이공원","맨발산책로"], tokens:["공원","산책","걷기","자연","맨발"]},
    {words:["대관","회의","강당","세미나","모임","공간"], cats:["공공시설","문화시설","복지시설","도서관"], tokens:["대관","회의실","강당","공간","다목적"]},
    {words:["문화","공연","행사","축제","전시","데이트"], cats:["문화시설","공연행사","프로그램","공원시설"], tokens:["문화","공연","행사","축제","전시"]},
    {words:["복지","상담","어르신","노인"], cats:["복지시설","공공시설"], tokens:["복지","상담","어르신","노인"]}
  ];
  rules.forEach(r=>{
    if(r.words.some(w=>q.includes(w))){ categories.push(...r.cats); tokens.push(...r.tokens); }
  });
  unique(facilities.map(f=>f.district)).forEach(d=>{ if(d && q.includes(d.replace(/\s/g,""))) districts.push(d); });
  Object.keys(areaGroups).forEach(group=>{
    const key = group.replace("권","").replace(/·/g,"");
    if(q.includes(key)) districts.push(group);
  });
  ["동탄","병점","봉담","향남","남양","서신","송산","우정","새솔","반월","진안"].forEach(area=>{ if(q.includes(area)) districts.push(area); });
  return {
    raw:query,
    categories:unique(categories),
    tokens:unique(tokens),
    districts:unique(districts),
    lowCrowd:q.includes("혼잡")||q.includes("한산")||q.includes("여유"),
    indoor:q.includes("실내")||q.includes("비"),
    reservable:q.includes("예약"),
    near:q.includes("근처")||q.includes("가까")||q.includes("주변")||q.includes("내위치")||q.includes("현재위치")
  };
}
function scoreFacility(f,intent,userContext){
  const text=[f.name,f.category,f.subCategory,f.district,f.space,f.address,f.fee,...(f.keywords||[])].join(" ");
  let score=0;
  intent.tokens.forEach(t=>{ if(text.includes(t)) score += 27; });
  if(intent.categories.includes(f.category)) score += 32;
  intent.districts.forEach(d=>{
    if(text.includes(d)) score += 38;
    if(areaGroups[d]?.includes(f.district)) score += 40;
  });
  if(intent.lowCrowd && f.crowd==="여유") score += 20;
  if(intent.indoor && !["공원시설","어린이공원","맨발산책로"].includes(f.category)) score += 10;
  if(intent.reservable && f.reservable) score += 12;
  if(f.fee && String(f.fee).includes("무료")) score += 4;
  score += locationScore(f,userContext);
  return score;
}
function enrich(f,userContext,reasons=[]){
  return {
    ...f,
    areaGroup: getAreaGroup(f.district),
    locationMeta: getLocationMeta(f,userContext),
    recommendationReasons: reasons.length ? reasons : buildReasons(f, analyzeQuery(""), userContext)
  };
}
function buildReasons(f,intent,userContext){
  const reasons=[];
  const meta = getLocationMeta(f,userContext);
  if(meta.type !== "none") reasons.push(meta.detail);
  if(intent.categories?.includes(f.category)) reasons.push(`${f.category} 목적과 잘 맞습니다.`);
  if(intent.lowCrowd && f.crowd==="여유") reasons.push("혼잡도가 낮은 시설입니다.");
  if(intent.indoor && !["공원시설","어린이공원","맨발산책로"].includes(f.category)) reasons.push("실내 또는 우천 시 대안으로 보기 좋습니다.");
  if(f.reservable) reasons.push("예약 가능 여부를 확인해볼 수 있습니다.");
  if(f.fee && String(f.fee).includes("무료")) reasons.push("무료 또는 저비용으로 이용할 수 있습니다.");
  if(!reasons.length) reasons.push("입력한 목적과 시설 키워드가 일치합니다.");
  return reasons.slice(0,4);
}
function makeCandidates(message,userContext){
  const intent = analyzeQuery(message);
  const scored = facilities
    .map(f=>({...f,_score:scoreFacility(f,intent,userContext), areaGroup:getAreaGroup(f.district), locationMeta:getLocationMeta(f,userContext)}))
    .filter(f=>f._score>0)
    .sort((a,b)=>b._score-a._score)
    .slice(0,16);
  return {intent,candidates:scored};
}
function buildRelated(recs,intent,userContext){
  if(!recs.length) return [];
  const main = recs[0];
  const recIds = new Set(recs.map(f=>Number(f.id)));
  const cats = intent.categories?.length ? intent.categories : [main.category,"주요시설","도서관","공원시설","문화시설"];
  return facilities.map(f=>{
      let score=0;
      if(recIds.has(Number(f.id))) return {...f,_score:-1};
      if(f.district===main.district) score+=28;
      if(cats.includes(f.category)) score+=24;
      if(getAreaGroup(f.district)===getAreaGroup(main.district)) score+=16;
      score += Math.round(locationScore(f,userContext)*0.55);
      if(f.crowd==="여유") score+=4;
      return {...f,_score:score};
    })
    .filter(f=>f._score>20)
    .sort((a,b)=>b._score-a._score)
    .slice(0,6)
    .map(f=>enrich(f,userContext));
}
function findFacilityById(id){
  return facilities.find(f=>Number(f.id)===Number(id));
}
function referencedFacility(message, selectedFacilityId, lastRecommendationIds=[], lastRelatedIds=[]){
  const q = String(message||"").replace(/\s/g,"");
  const ids = [...lastRecommendationIds, ...lastRelatedIds].map(Number);
  if(q.includes("1번")||q.includes("첫번째")||q.includes("첫째")) return findFacilityById(lastRecommendationIds[0]);
  if(q.includes("2번")||q.includes("두번째")||q.includes("둘째")) return findFacilityById(lastRecommendationIds[1]);
  if(q.includes("3번")||q.includes("세번째")||q.includes("셋째")) return findFacilityById(lastRecommendationIds[2]);
  const all = ids.map(findFacilityById).filter(Boolean);
  const byName = all.find(f=>q.includes(String(f.name||"").replace(/\s/g,"")));
  if(byName) return byName;
  if(selectedFacilityId) return findFacilityById(selectedFacilityId);
  return all[0] || null;
}
function isFollowup(message){
  const q = String(message||"").replace(/\s/g,"");
  return /(거기|여기|그곳|그거|1번|2번|3번|첫번째|두번째|세번째|거리|얼마나|몇km|현재위치|내위치|운영시간|몇시|예약|요금|무료|주소|전화|혼잡|주변|근처)/.test(q);
}
function contextFacts(message, f, userContext){
  if(!f) return null;
  const meta = getLocationMeta(f,userContext);
  return {
    facility: enrich(f,userContext),
    locationMeta: meta,
    facts: {
      name: f.name,
      district: f.district,
      areaGroup: getAreaGroup(f.district),
      category: f.category,
      address: f.address || "정보 없음",
      phone: f.phone || "정보 없음",
      hours: f.hours || "확인 필요",
      fee: f.fee || "확인 필요",
      crowd: f.crowd || "정보 없음",
      reservable: Boolean(f.reservable),
      distanceText: meta.distanceKm ? `대략 ${meta.distanceKm}km` : meta.detail
    }
  };
}
function fallback(message,userContext){
  const {intent,candidates} = makeCandidates(message,userContext);
  const recs = candidates.slice(0,3).map(f=>enrich(f,userContext,buildReasons(f,intent,userContext)));
  const related = buildRelated(recs,intent,userContext);
  return {
    mode:"system_fallback",
    answer: recs.length ? `요청하신 조건에 맞춰 화성시 시설 DB에서 ${recs.length}곳을 추천드릴게요. API 키가 없어 시스템 추천으로 표시합니다.` : "조건에 맞는 시설을 찾기 어려워요.",
    summary: "AI API 연결 전이라 목적·위치 기반 시스템 추천으로 처리했습니다.",
    intent,
    recommendations: recs,
    related,
    suggestions:["현재 위치랑 얼마나 멀어?","운영시간 알려줘","예약해야 해?"]
  };
}

export default async function handler(req,res){
  if(req.method !== "POST"){
    res.status(405).json({error:"POST only"});
    return;
  }

  const {message, userContext={}, selectedFacilityId=null, lastRecommendationIds=[], lastRelatedIds=[], history=[]} = req.body || {};
  if(!message || typeof message !== "string"){
    res.status(400).json({error:"message is required"});
    return;
  }

  const selected = referencedFacility(message, selectedFacilityId, lastRecommendationIds, lastRelatedIds);
  const followup = isFollowup(message);
  const context = followup ? contextFacts(message, selected, userContext) : null;
  const {intent,candidates} = makeCandidates(message,userContext);
  const candidateView = candidates.map(f=>({
    id:f.id, name:f.name, category:f.category, subCategory:f.subCategory,
    district:f.district, areaGroup:f.areaGroup, address:f.address,
    phone:f.phone, hours:f.hours, fee:f.fee, crowd:f.crowd, reservable:f.reservable,
    locationMeta:f.locationMeta, keywords:(f.keywords||[]).slice(0,8)
  }));

  if(!process.env.OPENAI_API_KEY){
    res.status(200).json(fallback(message,userContext));
    return;
  }

  try{
    const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: [
        {
          role:"system",
          content:[
            "너는 화성시민을 위한 AI 공공서비스 큐레이터 H-MATE다.",
            "사용자의 자연어를 이해하고, 위치 기준과 화성시 시설 DB를 바탕으로 답한다.",
            "시설 추천은 반드시 candidate_facilities 또는 selected_facility_fact 안의 시설만 사용한다.",
            "없는 시설명, 없는 주소, 없는 전화번호, 없는 운영시간을 지어내지 않는다.",
            "거리 정보는 제공된 locationMeta/facts만 사용한다. gps 거리도 읍면동 대표좌표 기준의 대략값이라고 설명한다.",
            "응답은 한국어로 친절하고 짧게 작성한다."
          ].join("\\n")
        },
        {
          role:"user",
          content: JSON.stringify({
            user_message: message,
            recent_history: history.slice(-8),
            user_location_context: userContext,
            is_followup: followup,
            selected_facility_fact: context,
            interpreted_intent: intent,
            candidate_facilities: candidateView
          }, null, 2)
        }
      ],
      text:{
        format:{
          type:"json_schema",
          name:"hmate_ai_location_response",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{
              responseType:{type:"string", enum:["recommend","answer_selected","clarify"]},
              answer:{type:"string"},
              summary:{type:"string"},
              recommendedIds:{type:"array", maxItems:3, items:{type:"integer"}},
              selectedFacilityId:{type:["integer","null"]},
              reasons:{
                type:"object",
                additionalProperties:{type:"array", maxItems:4, items:{type:"string"}}
              },
              followUpSuggestions:{type:"array", maxItems:3, items:{type:"string"}}
            },
            required:["responseType","answer","summary","recommendedIds","selectedFacilityId","reasons","followUpSuggestions"]
          }
        }
      }
    });

    const parsed = JSON.parse(response.output_text);
    const candidateIds = new Set(candidates.map(f=>Number(f.id)));
    let safeIds = (parsed.recommendedIds || []).filter(id=>candidateIds.has(Number(id))).slice(0,3);

    if(parsed.responseType === "recommend" && safeIds.length === 0){
      safeIds = candidates.slice(0,3).map(f=>Number(f.id));
    }

    const recommendations = safeIds
      .map(id=>candidates.find(f=>Number(f.id)===Number(id)) || findFacilityById(id))
      .filter(Boolean)
      .map(f=>enrich(f,userContext,parsed.reasons?.[String(f.id)] || buildReasons(f,intent,userContext)));

    const related = buildRelated(recommendations,intent,userContext);

    const selectedFacility = parsed.selectedFacilityId
      ? findFacilityById(parsed.selectedFacilityId)
      : selected;

    res.status(200).json({
      mode:"ai",
      answer: parsed.answer,
      summary: parsed.summary,
      intent,
      selectedFacility: selectedFacility ? enrich(selectedFacility,userContext,parsed.reasons?.[String(selectedFacility.id)] || []) : null,
      recommendations,
      related,
      suggestions: parsed.followUpSuggestions
    });
  }catch(err){
    console.error(err);
    res.status(200).json(fallback(message,userContext));
  }
}
