import fs from "fs";
import path from "path";
import OpenAI from "openai";

const facilities = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "facilities.json"), "utf-8"));
const areaGroups = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "areaGroups.json"), "utf-8"));
const districtCoords = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "districtCoords.json"), "utf-8"));
const adjacentGroups = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "adjacentGroups.json"), "utf-8"));

function unique(arr){ return [...new Set((arr || []).filter(Boolean))]; }
function getAllCategories(){ return unique(facilities.map(f => f.category)).sort(); }
function getAllDistricts(){ return unique(facilities.map(f => f.district)).sort(); }

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
    {words:["복지","상담","어르신","노인"], cats:["복지시설","공공시설"], tokens:["복지","상담","어르신","노인"]},
    {words:["더워","덥","시원","무더위","폭염","그늘"], cats:["도서관","문화시설","공공시설","복지시설"], tokens:["도서관","문화시설","실내","쉼터","휴식"]}
  ];
  rules.forEach(r=>{
    if(r.words.some(w=>q.includes(w))){ categories.push(...r.cats); tokens.push(...r.tokens); }
  });
  getAllDistricts().forEach(d=>{ if(d && q.includes(d.replace(/\s/g,""))) districts.push(d); });
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
    indoor:q.includes("실내")||q.includes("비")||q.includes("더워")||q.includes("덥")||q.includes("시원")||q.includes("무더위")||q.includes("폭염"),
    reservable:q.includes("예약"),
    near:q.includes("근처")||q.includes("가까")||q.includes("주변")||q.includes("내위치")||q.includes("현재위치"),
    freePreferred:q.includes("무료")||q.includes("돈")||q.includes("요금")
  };
}
function scoreFacility(f,intent,userContext){
  const text=[f.name,f.category,f.subCategory,f.district,f.space,f.address,f.fee,...(f.keywords||[])].join(" ");
  let score=0;
  intent.tokens.forEach(t=>{ if(text.includes(t)) score += 24; });
  if(intent.categories.includes(f.category)) score += 46;
  if(intent.avoidCategories?.includes(f.category)) score -= 48;
  intent.districts.forEach(d=>{
    if(text.includes(d)) score += 38;
    if(areaGroups[d]?.includes(f.district)) score += 40;
  });
  if(intent.lowCrowd && f.crowd==="여유") score += 20;
  if(intent.indoor && !["공원시설","어린이공원","맨발산책로","물놀이장"].includes(f.category)) score += 22;
  if(intent.indoor && ["공원시설","어린이공원","맨발산책로"].includes(f.category)) score -= 18;
  if(intent.reservable && f.reservable) score += 12;
  if(intent.freePreferred && f.fee && String(f.fee).includes("무료")) score += 10;
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
function searchFacilitiesFromAnalysis(message, analysis, userContext){
  const fallbackIntent = analyzeQuery(message);
  const categories = unique([...(analysis.targetCategories || []), ...(!analysis.targetCategories?.length ? fallbackIntent.categories : [])]);
  const tokens = unique([...(analysis.keywords || []), ...(!analysis.keywords?.length ? fallbackIntent.tokens : [])]);
  const districts = unique([...(analysis.targetDistricts || []), ...fallbackIntent.districts]);
  const constraints = analysis.constraints || {};
  const intent = {
    raw: message,
    categories,
    tokens,
    districts,
    avoidCategories: analysis.avoidCategories || [],
    lowCrowd: Boolean(constraints.lowCrowd || fallbackIntent.lowCrowd),
    indoor: Boolean(constraints.indoor || fallbackIntent.indoor),
    reservable: Boolean(constraints.reservable || fallbackIntent.reservable),
    near: Boolean(constraints.near || fallbackIntent.near),
    freePreferred: Boolean(constraints.freePreferred || fallbackIntent.freePreferred)
  };

  const scored = facilities
    .map(f=>({...f,_score:scoreFacility(f,intent,userContext), areaGroup:getAreaGroup(f.district), locationMeta:getLocationMeta(f,userContext)}))
    .filter(f=>f._score>0)
    .sort((a,b)=>b._score-a._score)
    .slice(0,18);

  return {intent, candidates:scored};
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
  const localIntent = analyzeQuery(message);
  const {intent,candidates} = searchFacilitiesFromAnalysis(message, {
    requestType:"recommend",
    targetCategories:localIntent.categories,
    targetDistricts:localIntent.districts,
    keywords:localIntent.tokens,
    avoidCategories:[],
    constraints:{
      lowCrowd:localIntent.lowCrowd,
      indoor:localIntent.indoor,
      reservable:localIntent.reservable,
      near:localIntent.near,
      freePreferred:localIntent.freePreferred
    }
  }, userContext);

  const recs = candidates.slice(0,3).map(f=>enrich(f,userContext,buildReasons(f,intent,userContext)));
  const related = buildRelated(recs,intent,userContext);

  if(!recs.length){
    return {
      mode:"system_fallback",
      responseType:"db_gap",
      answer:"현재 H-MATE 시설 DB만으로는 바로 추천하기 어려운 요청이에요. 공원, 도서관, 체육시설, 문화시설, 대관 공간처럼 등록된 화성시 공공시설 범위 안에서 다시 물어보시면 더 정확히 안내드릴게요.",
      summary:"현재 DB에서 직접 추천 가능한 후보가 없습니다.",
      intent,
      recommendations:[],
      related:[],
      suggestions:["도서관 추천","공원 추천","체육시설 추천"]
    };
  }

  return {
    mode:"system_fallback",
    responseType:"recommend",
    answer:`요청하신 조건에 맞춰 화성시 시설 DB에서 ${recs.length}곳을 추천드릴게요. 가장 먼저 볼 곳은 ${recs[0].name}입니다.`,
    summary:"화성시 시설 DB를 기준으로 목적과 위치를 반영해 추천했습니다.",
    intent,
    recommendations: recs,
    related,
    suggestions:["현재 위치와 거리","운영시간","예약 여부"]
  };
}

function usageFromResponse(response){
  return response?.usage || null;
}

async function analyzeIntentWithAI(client, {message, userContext, selected, context, history}){
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    input: [
      {
        role:"system",
        content:[
          "너는 H-MATE의 1차 의도 분석 AI다.",
          "사용자 문장을 키워드 하나로 단순 분류하지 말고, 문장 전체의 상황·목적·제약을 해석한다.",
          "H-MATE는 화성시 공공시설/생활서비스 추천 서비스이며, 추천은 반드시 서버가 보유한 시설 DB 안에서만 이루어진다.",
          "식당·카페·맛집처럼 민간 상업시설은 현재 DB 범위 밖이다.",
          "공공화장실처럼 공공서비스 성격은 있으나 DB에 전용 데이터가 없을 수 있다. 이 경우 db_gap으로 분류한다.",
          "복합 질문이면 compare로 분류할 수 있다. 예: 운동할까 책 읽을까.",
          "애매한 질문이면 clarify로 분류한다.",
          "답변 문장은 answerGuidance에 짧고 자연스럽게 작성한다.",
          "없는 운영시간, 요금, 위치를 지어내지 않는다."
        ].join("\\n")
      },
      {
        role:"user",
        content: JSON.stringify({
          user_message: message,
          recent_history: history.slice(-8),
          user_location_context: userContext,
          selected_facility_fact: context,
          selected_facility_name: selected?.name || null,
          available_facility_categories: getAllCategories(),
          registered_districts: getAllDistricts(),
          area_groups: Object.keys(areaGroups),
          current_db_limits: [
            "식당/카페/맛집/음식점 전용 DB 없음",
            "공공화장실 전용 DB 없음",
            "시설별 운영시간/요금/예약 정보는 일부 확인 필요일 수 있음"
          ]
        }, null, 2)
      }
    ],
    text:{
      format:{
        type:"json_schema",
        name:"hmate_intent_analysis",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          properties:{
            requestType:{type:"string", enum:["recommend","compare","answer_selected","clarify","db_gap","out_of_scope"]},
            mainIntent:{type:"string"},
            userSituation:{type:"array", maxItems:6, items:{type:"string"}},
            targetCategories:{type:"array", maxItems:6, items:{type:"string"}},
            avoidCategories:{type:"array", maxItems:6, items:{type:"string"}},
            targetDistricts:{type:"array", maxItems:6, items:{type:"string"}},
            keywords:{type:"array", maxItems:10, items:{type:"string"}},
            canRecommend:{type:"boolean"},
            missingData:{type:"array", maxItems:6, items:{type:"string"}},
            constraints:{
              type:"object",
              additionalProperties:false,
              properties:{
                near:{type:"boolean"},
                indoor:{type:"boolean"},
                lowCrowd:{type:"boolean"},
                reservable:{type:"boolean"},
                freePreferred:{type:"boolean"}
              },
              required:["near","indoor","lowCrowd","reservable","freePreferred"]
            },
            strategy:{type:"string"},
            answerGuidance:{type:"string"},
            followUpSuggestions:{type:"array", maxItems:3, items:{type:"string"}}
          },
          required:["requestType","mainIntent","userSituation","targetCategories","avoidCategories","targetDistricts","keywords","canRecommend","missingData","constraints","strategy","answerGuidance","followUpSuggestions"]
        }
      }
    }
  });
  return {analysis: JSON.parse(response.output_text), usage: usageFromResponse(response)};
}

async function finalCuratorWithAI(client, payload){
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    input: [
      {
        role:"system",
        content:[
          "너는 화성시민을 위한 AI 공공서비스 큐레이터 H-MATE다.",
          "1차 의도 분석 결과와 서버가 찾은 candidate_facilities를 바탕으로 최종 답변을 작성한다.",
          "추천은 반드시 candidate_facilities 또는 selected_facility_fact 안의 시설만 사용한다.",
          "candidate_facilities가 비어 있으면 시설을 지어내지 말고 db_gap 또는 clarify로 답한다.",
          "사용자가 비교 질문을 했다면 compare로 답하고, 후보 시설 중에서 선택지를 비교해준다.",
          "없는 시설명, 없는 주소, 없는 전화번호, 없는 운영시간, 없는 요금을 지어내지 않는다.",
          "운영시간, 요금, 예약 정보가 없으면 '확인 필요'라고 말한다.",
          "거리 정보는 제공된 locationMeta/facts만 사용한다. gps 거리는 읍면동 대표좌표 기준의 대략값이라고 설명한다.",
          "응답은 한국어로 친절하고 짧게 작성한다."
        ].join("\\n")
      },
      {
        role:"user",
        content: JSON.stringify(payload, null, 2)
      }
    ],
    text:{
      format:{
        type:"json_schema",
        name:"hmate_curator_response",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          properties:{
            responseType:{type:"string", enum:["recommend","compare","answer_selected","clarify","db_gap","out_of_scope"]},
            answer:{type:"string"},
            summary:{type:"string"},
            recommendedIds:{type:"array", maxItems:3, items:{type:"integer"}},
            selectedFacilityId:{type:["integer","null"]},
            reasonItems:{
              type:"array",
              maxItems:3,
              items:{
                type:"object",
                additionalProperties:false,
                properties:{
                  id:{type:"integer"},
                  reasons:{type:"array", maxItems:4, items:{type:"string"}}
                },
                required:["id","reasons"]
              }
            },
            followUpSuggestions:{type:"array", maxItems:3, items:{type:"string"}}
          },
          required:["responseType","answer","summary","recommendedIds","selectedFacilityId","reasonItems","followUpSuggestions"]
        }
      }
    }
  });
  return {parsed: JSON.parse(response.output_text), usage: usageFromResponse(response)};
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

  if(!process.env.OPENAI_API_KEY){
    res.status(200).json(fallback(message,userContext));
    return;
  }

  const selected = referencedFacility(message, selectedFacilityId, lastRecommendationIds, lastRelatedIds);
  const followup = isFollowup(message);
  const context = followup ? contextFacts(message, selected, userContext) : null;

  try{
    const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

    const {analysis, usage: intentUsage} = await analyzeIntentWithAI(client, {message, userContext, selected, context, history});

    // AI가 먼저 판단한 결과가 추천 불가/질문 보강이면 DB 검색 전에 바로 안내한다.
    if(!analysis.canRecommend || ["clarify","db_gap","out_of_scope"].includes(analysis.requestType)){
      res.status(200).json({
        mode:"ai",
        responseType:analysis.requestType,
        answer:analysis.answerGuidance,
        summary:analysis.strategy || analysis.mainIntent,
        intent:{
          raw:message,
          categories:analysis.targetCategories || [],
          tokens:analysis.keywords || [],
          districts:analysis.targetDistricts || [],
          lowCrowd:Boolean(analysis.constraints?.lowCrowd),
          indoor:Boolean(analysis.constraints?.indoor),
          reservable:Boolean(analysis.constraints?.reservable),
          near:Boolean(analysis.constraints?.near),
          freePreferred:Boolean(analysis.constraints?.freePreferred),
          missingData:analysis.missingData || []
        },
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:analysis.followUpSuggestions?.length ? analysis.followUpSuggestions : ["도서관 추천","공원 추천","체육시설 추천"],
        analysis,
        usage:{intent:intentUsage, final:null}
      });
      return;
    }

    const {intent,candidates} = searchFacilitiesFromAnalysis(message, analysis, userContext);
    const candidateView = candidates.map(f=>({
      id:f.id, name:f.name, category:f.category, subCategory:f.subCategory,
      district:f.district, areaGroup:f.areaGroup, address:f.address,
      phone:f.phone, hours:f.hours, fee:f.fee, crowd:f.crowd, reservable:f.reservable,
      locationMeta:f.locationMeta, keywords:(f.keywords||[]).slice(0,8)
    }));

    if(!candidateView.length && ["recommend","compare"].includes(analysis.requestType)){
      res.status(200).json({
        mode:"ai",
        responseType:"db_gap",
        answer:"요청하신 의도는 이해했지만, 현재 H-MATE 시설 DB에서 바로 추천할 수 있는 후보를 찾지 못했습니다. DB를 확장하면 더 정확히 안내할 수 있어요.",
        summary:"AI 의도 분석 후 DB 후보가 부족한 상태입니다.",
        intent,
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:analysis.followUpSuggestions?.length ? analysis.followUpSuggestions : ["도서관 추천","공원 추천","체육시설 추천"],
        analysis,
        usage:{intent:intentUsage, final:null}
      });
      return;
    }

    const {parsed, usage: finalUsage} = await finalCuratorWithAI(client, {
      user_message: message,
      recent_history: history.slice(-8),
      user_location_context: userContext,
      is_followup: followup,
      selected_facility_fact: context,
      intent_analysis: analysis,
      candidate_facilities: candidateView
    });

    const reasonMap = Object.fromEntries((parsed.reasonItems || []).map(item => [String(item.id), item.reasons || []]));
    const candidateIds = new Set(candidates.map(f=>Number(f.id)));

    let safeIds = [];
    if(["recommend","compare"].includes(parsed.responseType)){
      safeIds = (parsed.recommendedIds || []).filter(id=>candidateIds.has(Number(id))).slice(0,3);
      if(safeIds.length === 0 && candidates.length){
        safeIds = candidates.slice(0,3).map(f=>Number(f.id));
      }
    }

    const recommendations = safeIds
      .map(id=>candidates.find(f=>Number(f.id)===Number(id)) || findFacilityById(id))
      .filter(Boolean)
      .map(f=>enrich(f,userContext,reasonMap[String(f.id)] || buildReasons(f,intent,userContext)));

    const related = ["recommend","compare"].includes(parsed.responseType) ? buildRelated(recommendations,intent,userContext) : [];

    const selectedFacility = parsed.selectedFacilityId
      ? findFacilityById(parsed.selectedFacilityId)
      : selected;

    res.status(200).json({
      mode:"ai",
      responseType: parsed.responseType,
      answer: parsed.answer,
      summary: parsed.summary,
      intent,
      selectedFacility: selectedFacility ? enrich(selectedFacility,userContext,reasonMap[String(selectedFacility.id)] || []) : null,
      recommendations,
      related,
      suggestions: parsed.followUpSuggestions?.length ? parsed.followUpSuggestions : ["현재 위치와 거리","운영시간","예약 여부"],
      analysis,
      usage:{intent:intentUsage, final:finalUsage}
    });
  }catch(err){
    console.error(err);
    res.status(200).json(fallback(message,userContext));
  }
}
