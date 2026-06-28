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

const areaAliases = {
  "동탄":"동탄권",
  "동탄권":"동탄권",
  "병점":"병점·진안권",
  "진안":"병점·진안권",
  "화산":"병점·진안권",
  "봉담":"봉담·매송권",
  "매송":"봉담·매송권",
  "남양":"남양·새솔권",
  "새솔":"남양·새솔권",
  "송산":"남양·새솔권",
  "향남":"향남·팔탄권",
  "팔탄":"향남·팔탄권",
  "정남":"향남·팔탄권",
  "서신":"서부해안권",
  "우정":"서부해안권"
};

const placeAreaAliases = {
  "동탄역":"동탄권",
  "동탄남광장":"동탄권",
  "동탄북광장":"동탄권",
  "남광장":"동탄권",
  "북광장":"동탄권",
  "동탄호수공원":"동탄권",
  "동탄센트럴파크":"동탄권",
  "센트럴파크":"동탄권",
  "병점역":"병점·진안권",
  "진안동":"병점·진안권",
  "봉담읍":"봉담·매송권",
  "봉담중심상가":"봉담·매송권",
  "향남읍":"향남·팔탄권",
  "향남중심상가":"향남·팔탄권",
  "향남홈플러스":"향남·팔탄권",
  "남양읍":"남양·새솔권",
  "새솔동":"남양·새솔권",
  "송산그린시티":"남양·새솔권",
  "송산면":"남양·새솔권",
  "제부도":"서부해안권",
  "궁평항":"서부해안권",
  "전곡항":"서부해안권",
  "매향리":"서부해안권"
};

function compactText(value){
  return String(value || "").replace(/\s/g,"").toLowerCase();
}
function detectAreaMentions(value){
  const raw = compactText(value);
  const found = [];
  if(!raw) return found;

  for(const [key, group] of Object.entries(placeAreaAliases)){
    if(raw.includes(compactText(key))) found.push(group);
  }
  for(const [key, group] of Object.entries(areaAliases)){
    if(raw.includes(compactText(key))) found.push(group);
  }
  for(const [group, districts] of Object.entries(areaGroups)){
    const groupKey = compactText(group).replace("권","");
    if(groupKey && raw.includes(groupKey)) found.push(group);
    (districts || []).forEach(d=>{
      if(d && raw.includes(compactText(d))){
        found.push(group);
        found.push(d);
      }
    });
  }
  getAllDistricts().forEach(d=>{
    if(d && raw.includes(compactText(d))) found.push(d);
  });

  return unique(found);
}
function hasAnyCompact(q, words=[]){
  return words.some(w => q.includes(compactText(w)));
}
function classifyDbLimit(message){
  const q = compactText(message);
  const foodWords = ["배고","밥","식사","저녁","점심","아침","먹을곳","맛집","식당","카페","커피","디저트"];
  const publicPurposeWords = ["운동","축구","풋살","체육","도서관","책","독서","공부","공원","산책","아이","가족","행사","공연","전시","문화","대관","시설","수영","농구"];
  const eventWords = ["행사","축제","공연","전시","프로그램"];
  const realtimeWords = ["오늘","내일","이번주","이번주말","주말","지금","실시간","열리는","일정","몇시","시간표"];
  return {
    toilet: hasAnyCompact(q, ["화장실","공중화장실","공공화장실"]),
    foodOnly: hasAnyCompact(q, foodWords) && !hasAnyCompact(q, publicPurposeWords),
    realtimeEvent: hasAnyCompact(q, eventWords) && hasAnyCompact(q, realtimeWords),
    eventLike: hasAnyCompact(q, eventWords)
  };
}
function polishAnswer(text){
  return String(text || "")
    .replace(/추천\s*기준\s*미설정/g, "말씀하신 조건")
    .replace(/위치\s*기준\s*없음/g, "입력한 조건")
    .replace(/DB\s*후보/g, "추천 시설")
    .replace(/후보/g, "시설")
    .replace(/목적\s*중심/g, "입력한 목적 기준")
    .replace(/위도\s*-?\d+(?:\.\d+)?\s*,?\s*경도\s*-?\d+(?:\.\d+)?/g, "현재 위치")
    .replace(/현재\s*위치는\s*위도[^.。<\n]*[.。]?/g, "현재 위치 기준으로 확인했어요.")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getAreaGroup(district){
  for(const [group, ds] of Object.entries(areaGroups)){
    if(ds.includes(district)) return group;
  }
  return "화성시";
}
function normalizeAreaHint(value){
  const raw = compactText(value);
  if(!raw) return null;
  for(const [key, group] of Object.entries(placeAreaAliases)){
    if(raw.includes(compactText(key))) return group;
  }
  for(const [key, group] of Object.entries(areaAliases)){
    if(raw.includes(compactText(key))) return group;
  }
  if(areaGroups[value]) return value;
  return null;
}
function expandDistrictTargets(targets=[]){
  const expanded = [];
  targets.forEach(t=>{
    const raw = String(t || "").trim();
    if(!raw) return;
    const area = normalizeAreaHint(raw);
    if(area){
      expanded.push(area);
      expanded.push(...(areaGroups[area] || []));
    }else{
      expanded.push(raw);
    }
  });
  return unique(expanded);
}
function calcDistanceKm(lat1,lng1,lat2,lng2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getGpsHwaseongStatus(userContext={}){
  const lat = Number(userContext.lat);
  const lng = Number(userContext.lng);
  const hasGps = userContext.mode === "gps" && Number.isFinite(lat) && Number.isFinite(lng);
  if(!hasGps){
    return {hasGps:false, inHwaseong:false, outsideHwaseong:false, nearestDistrict:null, nearestAreaGroup:null, nearestDistanceKm:null, reason:"no_gps"};
  }

  let nearest = null;
  for(const [district, coord] of Object.entries(districtCoords || {})){
    if(!coord || !Number.isFinite(Number(coord.lat)) || !Number.isFinite(Number(coord.lng))) continue;
    const km = calcDistanceKm(lat,lng,Number(coord.lat),Number(coord.lng));
    if(!nearest || km < nearest.km) nearest = {district, km};
  }

  const inBroadBox = lat >= 36.92 && lat <= 37.36 && lng >= 126.48 && lng <= 127.24;
  const nearestDistanceKm = nearest ? Number(nearest.km.toFixed(1)) : null;

  // 실제 행정구역 폴리곤이 없기 때문에 읍면동 대표 좌표와 넓은 경계값으로 보수적으로 판단한다.
  // 화성 밖이 확실하면 GPS를 추천 기준으로 쓰지 않고, 사용자가 말한 화성 내 지역을 우선한다.
  const inHwaseong = Boolean(inBroadBox && nearest && nearest.km <= 16);
  const outsideHwaseong = Boolean(!inHwaseong);

  return {
    hasGps:true,
    inHwaseong,
    outsideHwaseong,
    nearestDistrict:nearest?.district || null,
    nearestAreaGroup:nearest ? getAreaGroup(nearest.district) : null,
    nearestDistanceKm,
    reason: inHwaseong ? "gps_inside_hwaseong" : "gps_outside_hwaseong"
  };
}
function sanitizeUserContextForAI(userContext={}){
  const gps = getGpsHwaseongStatus(userContext);
  return {
    mode:userContext.mode || "none",
    selectedAreaGroup:userContext.selectedAreaGroup || null,
    hasGps:gps.hasGps,
    gpsInsideHwaseong:gps.inHwaseong,
    gpsOutsideHwaseong:gps.outsideHwaseong,
    nearestHwaseongArea:gps.nearestAreaGroup,
    nearestHwaseongDistrict:gps.nearestDistrict,
    approximateDistanceToNearestHwaseongDistrictKm:gps.nearestDistanceKm,
    note:gps.hasGps
      ? (gps.inHwaseong ? "현재 위치를 화성시 안으로 볼 수 있음" : "현재 위치가 화성시 밖으로 보임. 사용자가 화성 내 지역을 말하지 않으면 지역을 먼저 물어봐야 함")
      : "GPS 없음. 대화에서 언급한 지역이나 사용자가 선택한 권역을 기준으로 판단"
  };
}
function firstAreaFromTargets(targets=[]){
  for(const t of targets || []){
    const area = normalizeAreaHint(t);
    if(area) return area;
    if(areaGroups[t]) return t;
    const directDistrictArea = getAllDistricts().includes(t) ? getAreaGroup(t) : null;
    if(directDistrictArea && directDistrictArea !== "화성시") return directDistrictArea;
  }
  return null;
}

function normalizeDistrictHint(value){
  const raw = compactText(value);
  if(!raw) return null;
  const districts = getAllDistricts();

  // 정확한 읍면동명 우선: "동탄 6동"처럼 띄어쓰기가 있어도 잡는다.
  for(const d of districts){
    if(raw.includes(compactText(d))) return d;
  }

  // 동탄숫자동 패턴 보강
  const m = raw.match(/동탄(\d{1,2})동/);
  if(m){
    const candidate = `동탄${m[1]}동`;
    if(districts.includes(candidate)) return candidate;
  }

  // 향남읍/봉담읍/남양읍 등 행정읍면동 단위는 getAllDistricts에 있으면 잡힘.
  return null;
}
function firstDistrictFromTargets(targets=[]){
  for(const t of targets || []){
    const d = normalizeDistrictHint(t);
    if(d) return d;
  }
  return null;
}
function getReferenceCoordFromDistrict(district){
  const c = districtCoords?.[district];
  if(!district || !c) return null;
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat,lng,district,areaGroup:getAreaGroup(district)};
}
function basisLabelFromContext(userContext={}){
  if(userContext.mode === "reference" && userContext.basisPlaceName) return `${userContext.basisPlaceName} 기준`;
  if(userContext.basisDistrict) return `${userContext.basisDistrict} 기준`;
  if(userContext.mode === "district" && userContext.selectedAreaGroup) return `${userContext.selectedAreaGroup} 기준`;
  if(userContext.mode === "gps") return "현재 위치 기준";
  return "조건 기준";
}

function nearestDistrictFromCoord(lat,lng){
  let nearest = null;
  for(const [district, coord] of Object.entries(districtCoords || {})){
    if(!coord || !Number.isFinite(Number(coord.lat)) || !Number.isFinite(Number(coord.lng))) continue;
    const km = calcDistanceKm(Number(lat), Number(lng), Number(coord.lat), Number(coord.lng));
    if(!nearest || km < nearest.km) nearest = {district, km, areaGroup:getAreaGroup(district)};
  }
  return nearest ? {...nearest, km:Number(nearest.km.toFixed(1))} : null;
}
function getFacilityCoord(f){
  const lat = Number(f.lat ?? f.latitude);
  const lng = Number(f.lng ?? f.longitude ?? f.lon);
  if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng,source:"facility"};
  const c = districtCoords?.[f.district];
  if(c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))){
    return {lat:Number(c.lat), lng:Number(c.lng), source:"district"};
  }
  return null;
}
function looksLikeAddress(text){
  const q = String(text || "");
  return /(로|길|번길)\s*\d+/.test(q) || /(경기도|화성시).*(로|길|번길)/.test(q);
}
function extractAddressCandidate(message){
  const msg = String(message || "").replace(/\s+/g," ").trim();
  const match = msg.match(/((?:경기도\s*)?(?:화성시\s*)?[가-힣0-9\s·.-]{1,35}(?:로|길|번길)\s*\d+(?:-\d+)?)/);
  if(!match) return null;
  return match[1].replace(/^(근처|주변|인근)\s*/,"").trim();
}
function trimLocationPhrase(text){
  return String(text || "")
    .replace(/(근처|주변|인근|쪽|부근|앞|에서|으로|기준|근방)/g," ")
    .replace(/(축구|풋살|운동|체육|도서관|공부|책|독서|아이|가족|어린이|갈만한|갈\s*만한|추천|찾아줘|하고\s*싶어|할\s*만한\s*곳|할만한곳|있어|좋은곳|곳)/g," ")
    .replace(/\s{2,}/g," ")
    .trim();
}
function extractPlaceCandidate(message){
  const msg = String(message || "").replace(/\s+/g," ").trim();
  const patterns = [
    /(.{2,30}?)(?:\s*)(?:근처|주변|인근|부근|앞)/,
    /(.{2,30}?)(?:\s*)(?:에서|쪽)(?:\s*)(?:축구|풋살|운동|도서관|공부|책|아이|가족|갈|추천|찾)/
  ];
  for(const p of patterns){
    const m = msg.match(p);
    if(m){
      const cand = trimLocationPhrase(m[1]);
      if(cand && cand.length >= 2 && !normalizeDistrictHint(cand) && !normalizeAreaHint(cand)){
        return cand;
      }
    }
  }
  return null;
}
function localReferenceLocationHints(message, analysis={}, localHints={}){
  const candidates = [];
  const exactDistrict = firstDistrictFromTargets(localHints.explicitDistrictMentions || localHints.districts || []);
  if(exactDistrict) return [];

  const addr = extractAddressCandidate(message);
  if(addr) candidates.push({text:addr, type:"address", source:"local_address"});

  if(analysis.targetLocationText && analysis.targetLocationText !== "none"){
    candidates.push({
      text:analysis.targetLocationText,
      type:analysis.targetLocationType || (looksLikeAddress(analysis.targetLocationText) ? "address" : "place"),
      source:"ai"
    });
  }

  const place = extractPlaceCandidate(message);
  if(place) candidates.push({text:place, type:looksLikeAddress(place) ? "address" : "place", source:"local_place"});

  return unique(candidates.map(c=>JSON.stringify(c))).map(s=>JSON.parse(s)).filter(c=>c.text && c.text.length >= 2);
}
async function kakaoLocalRequest(endpoint, params){
  const key = process.env.KAKAO_REST_API_KEY;
  if(!key) return null;
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${endpoint}.json`);
  Object.entries(params || {}).forEach(([k,v])=>{
    if(v !== undefined && v !== null && String(v).trim() !== "") url.searchParams.set(k,String(v));
  });
  const response = await fetch(url, {
    headers:{ Authorization:`KakaoAK ${key}` }
  });
  if(!response.ok) return null;
  return await response.json();
}
function kakaoDocToLocation(doc, query, type){
  if(!doc) return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = doc.road_address_name || doc.address_name || doc.address?.address_name || doc.road_address?.address_name || "";
  const name = doc.place_name || query;
  const nearest = nearestDistrictFromCoord(lat,lng);
  const inBroadBox = lat >= 36.92 && lat <= 37.36 && lng >= 126.48 && lng <= 127.24;
  const isHwaseong = /화성시/.test(address) || Boolean(inBroadBox && nearest && nearest.km <= 18);
  return {
    query,
    name,
    type,
    lat,
    lng,
    address,
    nearestDistrict:nearest?.district || null,
    nearestAreaGroup:nearest?.areaGroup || null,
    nearestDistanceKm:nearest?.km ?? null,
    isHwaseong
  };
}
async function searchKakaoAddress(query){
  const variants = unique([query, query.includes("화성") ? query : `화성시 ${query}`, query.includes("경기도") ? query : `경기도 화성시 ${query}`]);
  for(const q of variants){
    const data = await kakaoLocalRequest("address", {query:q, size:5});
    const docs = data?.documents || [];
    const converted = docs.map(d=>kakaoDocToLocation(d,q,"address")).filter(Boolean);
    const hwaseong = converted.find(x=>x.isHwaseong);
    if(hwaseong) return hwaseong;
    if(converted[0]) return converted[0];
  }
  return null;
}
function expandPlaceSearchVariants(query){
  const q = String(query || "").trim();
  const compact = q.replace(/\s/g,"");
  const variants = [q];

  // 학교 약칭 보강: 반월초 -> 반월초등학교, 안화고 -> 안화고등학교
  if(/[가-힣0-9]+초$/.test(compact)) variants.push(compact.replace(/초$/,"초등학교"));
  if(/[가-힣0-9]+중$/.test(compact)) variants.push(compact.replace(/중$/,"중학교"));
  if(/[가-힣0-9]+고$/.test(compact)) variants.push(compact.replace(/고$/,"고등학교"));

  // 이미 학교가 들어간 경우도 공백 제거 버전을 추가
  if(/초등학교|중학교|고등학교|대학교|역|공원|센터|도서관/.test(compact)) variants.push(compact);

  return unique(variants.filter(Boolean));
}
async function searchKakaoKeyword(query){
  const baseVariants = expandPlaceSearchVariants(query);
  const variants = unique(baseVariants.flatMap(v=>[
    v,
    v.includes("화성") ? v : `화성시 ${v}`,
    v.includes("경기도") ? v : `경기도 화성시 ${v}`
  ]));
  for(const q of variants){
    const data = await kakaoLocalRequest("keyword", {query:q, size:10});
    const docs = data?.documents || [];
    const converted = docs.map(d=>kakaoDocToLocation(d,q,"place")).filter(Boolean);
    const hwaseong = converted.find(x=>x.isHwaseong && /화성시/.test(x.address));
    if(hwaseong) return hwaseong;
    const nearHwaseong = converted.find(x=>x.isHwaseong);
    if(nearHwaseong) return nearHwaseong;
  }
  return null;
}
async function resolveKakaoLocation(message, analysis={}, localHints={}){
  const candidates = localReferenceLocationHints(message, analysis, localHints);
  if(!candidates.length || !process.env.KAKAO_REST_API_KEY) return null;

  for(const cand of candidates.slice(0,3)){
    let found = null;
    if(cand.type === "address" || looksLikeAddress(cand.text)){
      found = await searchKakaoAddress(cand.text);
      if(!found) found = await searchKakaoKeyword(cand.text);
    }else{
      found = await searchKakaoKeyword(cand.text);
      if(!found) found = await searchKakaoAddress(cand.text);
    }
    if(found && found.isHwaseong){
      return {...found, originalText:cand.text, source:cand.source};
    }
  }
  return null;
}

function resolveRecommendationContext(userContext={}, analysis={}, localHints={}, kakaoLocation=null){
  const gps = getGpsHwaseongStatus(userContext);

  // 우선순위:
  // 1) 정확한 읍면동
  // 2) 카카오 Local API로 찾은 주소/장소 좌표
  // 3) 권역/생활지명
  // 4) 대화 맥락
  // 5) 선택 권역
  // 6) GPS
  // 7) 목적 중심
  const directDistrict = firstDistrictFromTargets(localHints.explicitDistrictMentions || localHints.explicitAreaMentions || localHints.districts || []);
  const aiDistrict = firstDistrictFromTargets(analysis.targetDistricts || []);
  const directArea = firstAreaFromTargets(localHints.explicitAreaMentions || localHints.districts || []);
  const aiArea = firstAreaFromTargets(analysis.targetDistricts || []);
  const selectedArea = normalizeAreaHint(userContext.selectedAreaGroup);
  const aiBasis = analysis.recommendationBasis || "purpose_only";
  const aiAreaIsContextual = ["home_area","destination_area","mentioned_area","mentioned_district","reference_location"].includes(aiBasis);

  if(directDistrict){
    const ref = getReferenceCoordFromDistrict(directDistrict);
    const area = getAreaGroup(directDistrict);
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:area, basisDistrict:directDistrict, basisPlaceName:null, referenceLat:ref?.lat, referenceLng:ref?.lng, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:"mentioned_district", needsAreaClarification:false, areaGroup:area, basisDistrict:directDistrict, referenceLocation:null,
      note:gps.hasGps ? "GPS보다 사용자가 현재 질문에서 직접 말한 읍면동을 우선" : "사용자가 현재 질문에서 직접 말한 읍면동 기준 추천"
    };
  }

  if(kakaoLocation?.lat && kakaoLocation?.lng){
    const area = kakaoLocation.nearestAreaGroup || "화성시";
    const nearestDistrict = kakaoLocation.nearestDistrict || null;
    return {
      userContext:{
        ...userContext,
        mode:"reference",
        selectedAreaGroup:area,
        basisDistrict:nearestDistrict,
        basisPlaceName:kakaoLocation.name || kakaoLocation.originalText || "입력 위치",
        basisAddress:kakaoLocation.address || "",
        referenceLat:kakaoLocation.lat,
        referenceLng:kakaoLocation.lng,
        lat:undefined,
        lng:undefined
      },
      gpsStatus:gps,
      usedBasis:"reference_location",
      needsAreaClarification:false,
      areaGroup:area,
      basisDistrict:nearestDistrict,
      referenceLocation:kakaoLocation,
      note:"사용자가 말한 주소/장소를 카카오 Local API로 좌표 검색해 기준 위치로 사용"
    };
  }

  if(directArea){
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:directArea, basisDistrict:null, basisPlaceName:null, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:"mentioned_area", needsAreaClarification:false, areaGroup:directArea, basisDistrict:null, referenceLocation:null,
      note:gps.hasGps ? "GPS보다 사용자가 현재 질문에서 직접 말한 지역을 우선" : "사용자가 현재 질문에서 직접 말한 지역 기준 추천"
    };
  }

  if(aiDistrict && aiAreaIsContextual){
    const ref = getReferenceCoordFromDistrict(aiDistrict);
    const area = getAreaGroup(aiDistrict);
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:area, basisDistrict:aiDistrict, basisPlaceName:null, referenceLat:ref?.lat, referenceLng:ref?.lng, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:aiBasis === "purpose_only" ? "mentioned_district" : aiBasis, needsAreaClarification:false, areaGroup:area, basisDistrict:aiDistrict, referenceLocation:null,
      note:"대화 맥락에서 나온 정확한 읍면동 기준 추천"
    };
  }

  if(aiArea && aiAreaIsContextual){
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:aiArea, basisDistrict:null, basisPlaceName:null, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:aiBasis, needsAreaClarification:false, areaGroup:aiArea, basisDistrict:null, referenceLocation:null,
      note:"대화 맥락에서 나온 집·목적지·가려는 지역 기준 추천"
    };
  }

  if(selectedArea){
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:selectedArea, basisDistrict:null, basisPlaceName:null, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:"selected_area", needsAreaClarification:false, areaGroup:selectedArea, basisDistrict:null, referenceLocation:null,
      note:gps.outsideHwaseong ? "GPS는 화성 밖이라 선택 권역을 기준으로 추천" : "사용자가 선택한 화성 권역 기준 추천"
    };
  }

  if(gps.hasGps && gps.outsideHwaseong){
    return {
      userContext:{...userContext, mode:"none", basisDistrict:null, basisPlaceName:null, lat:undefined, lng:undefined},
      gpsStatus:gps, usedBasis:"outside_gps_no_area", needsAreaClarification:true, areaGroup:null, basisDistrict:null, referenceLocation:null,
      note:"현재 위치가 화성시 밖이고 화성 내 기준 지역이 없음"
    };
  }

  if(gps.hasGps && gps.inHwaseong){
    return {
      userContext:{...userContext, mode:"gps", basisDistrict:null, basisPlaceName:null},
      gpsStatus:gps, usedBasis:"gps", needsAreaClarification:false, areaGroup:gps.nearestAreaGroup, basisDistrict:null, referenceLocation:null,
      note:"현재 위치 기준 추천 가능"
    };
  }

  if(aiDistrict){
    const ref = getReferenceCoordFromDistrict(aiDistrict);
    const area = getAreaGroup(aiDistrict);
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:area, basisDistrict:aiDistrict, basisPlaceName:null, referenceLat:ref?.lat, referenceLng:ref?.lng},
      gpsStatus:gps, usedBasis:"mentioned_district", needsAreaClarification:false, areaGroup:area, basisDistrict:aiDistrict, referenceLocation:null,
      note:"AI가 해석한 정확한 읍면동 기준 추천"
    };
  }

  if(aiArea){
    return {
      userContext:{...userContext, mode:"district", selectedAreaGroup:aiArea, basisDistrict:null, basisPlaceName:null},
      gpsStatus:gps, usedBasis:"mentioned_area", needsAreaClarification:false, areaGroup:aiArea, basisDistrict:null, referenceLocation:null,
      note:"AI가 해석한 화성 내 지역 기준 추천"
    };
  }

  return {
    userContext:{...userContext, mode:userContext.mode || "none", basisDistrict:null, basisPlaceName:null},
    gpsStatus:gps, usedBasis:"purpose_only", needsAreaClarification:false, areaGroup:null, basisDistrict:null, referenceLocation:null,
    note:"위치 기준 없이 목적과 조건을 기준으로 추천"
  };
}
function outsideGpsClarifyAnswer(message, analysis, gpsStatus){
  const lead = String(analysis?.answerLead || "").trim();
  const base = "현재 위치가 화성시 밖으로 보여요. H-MATE는 화성시 공공시설 DB를 기준으로 추천해드리고 있어서, 동탄·병점·봉담·향남처럼 화성시 안에서 어느 지역 기준으로 볼지 알려주시면 더 정확하게 찾아드릴게요.";
  if(lead && !/위도|경도|추천 기준 미설정|위치 기준 없음/.test(lead)){
    return `${lead}<br>${base}`;
  }
  return base;
}
function getLocationMeta(f, userContext={}){
  const area = getAreaGroup(f.district);

  if(userContext.mode === "reference" && Number.isFinite(Number(userContext.referenceLat)) && Number.isFinite(Number(userContext.referenceLng))){
    const basis = userContext.basisPlaceName || userContext.basisAddress || "입력 위치";
    const fc = getFacilityCoord(f);
    if(fc){
      const km = calcDistanceKm(Number(userContext.referenceLat), Number(userContext.referenceLng), fc.lat, fc.lng);
      if(km <= 1.5) return { type:"referenceVeryNear", label:`${basis} 기준 약 ${km.toFixed(1)}km`, detail:`${basis} 주변에서 매우 가까운 시설`, distanceKm:Number(km.toFixed(1)), distanceSource:fc.source };
      if(km <= 4) return { type:"referenceNear", label:`${basis} 기준 약 ${km.toFixed(1)}km`, detail:`${basis} 주변에서 가까운 시설`, distanceKm:Number(km.toFixed(1)), distanceSource:fc.source };
      if(km <= 8) return { type:"referenceMid", label:`${basis} 기준 약 ${km.toFixed(1)}km`, detail:`${basis} 기준 접근 가능한 시설`, distanceKm:Number(km.toFixed(1)), distanceSource:fc.source };
      if(area === userContext.selectedAreaGroup) return { type:"sameArea", label:`${basis} 기준 약 ${km.toFixed(1)}km`, detail:`${basis}이 포함된 권역의 시설`, distanceKm:Number(km.toFixed(1)), distanceSource:fc.source };
      return { type:"none", label:`${basis} 기준 약 ${km.toFixed(1)}km`, detail:"입력 위치와 거리가 있는 화성시 시설", distanceKm:Number(km.toFixed(1)), distanceSource:fc.source };
    }
    if(userContext.basisDistrict && f.district === userContext.basisDistrict){
      return { type:"sameDistrict", label:`${basis} 주변`, detail:`${basis}이 속한 ${userContext.basisDistrict} 내 시설` };
    }
    return { type:"none", label:`${basis} 기준`, detail:"입력 위치 기준 추천" };
  }

  // 사용자가 정확한 읍면동을 말한 경우
  if(userContext.mode === "district" && userContext.basisDistrict){
    if(f.district === userContext.basisDistrict){
      return { type:"sameDistrict", label:`${userContext.basisDistrict} 내 시설`, detail:`${userContext.basisDistrict} 기준으로 가장 직접적인 시설` };
    }
    if(Number.isFinite(Number(userContext.referenceLat)) && Number.isFinite(Number(userContext.referenceLng)) && districtCoords[f.district]){
      const c = districtCoords[f.district];
      const km = calcDistanceKm(Number(userContext.referenceLat), Number(userContext.referenceLng), Number(c.lat), Number(c.lng));
      if(km <= 3) return { type:"districtVeryNear", label:`${userContext.basisDistrict} 기준 약 ${km.toFixed(1)}km`, detail:`${userContext.basisDistrict}과 매우 가까운 시설`, distanceKm:Number(km.toFixed(1)) };
      if(km <= 7) return { type:"districtNear", label:`${userContext.basisDistrict} 기준 약 ${km.toFixed(1)}km`, detail:`${userContext.basisDistrict} 기준 가까운 시설`, distanceKm:Number(km.toFixed(1)) };
      if(area === userContext.selectedAreaGroup) return { type:"sameArea", label:`${userContext.selectedAreaGroup} 내 시설`, detail:`${userContext.basisDistrict} 인근 권역 시설`, distanceKm:Number(km.toFixed(1)) };
      return { type:"none", label:`${userContext.basisDistrict} 기준 약 ${km.toFixed(1)}km`, detail:"입력한 지역과 거리가 있는 화성시 시설", distanceKm:Number(km.toFixed(1)) };
    }
    if(area === userContext.selectedAreaGroup) return { type:"sameArea", label:`${userContext.selectedAreaGroup} 내 시설`, detail:`${userContext.basisDistrict}이 포함된 권역 시설` };
    return { type:"none", label:"조건 기준", detail:"입력한 목적과 조건을 기준으로 추천" };
  }

  if(userContext.mode === "district" && userContext.selectedAreaGroup){
    if(area === userContext.selectedAreaGroup) return { type:"sameArea", label:"선택 권역과 가까움", detail:`${userContext.selectedAreaGroup} 내 시설` };
    if(adjacentGroups[userContext.selectedAreaGroup]?.includes(area)) return { type:"nearArea", label:"인접 권역", detail:`${userContext.selectedAreaGroup} 인근 ${area}` };
    return { type:"none", label:"화성시 시설", detail:"선택 권역 외 시설" };
  }
  if(userContext.mode === "gps" && userContext.lat && userContext.lng){
    const fc = getFacilityCoord(f);
    if(fc){
      const km = calcDistanceKm(userContext.lat, userContext.lng, fc.lat, fc.lng);
      if(km <= 3) return { type:"gpsVeryNear", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치와 매우 가까운 시설", distanceKm: Number(km.toFixed(1)), distanceSource:fc.source };
      if(km <= 7) return { type:"gpsNear", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치 기준 가까운 시설", distanceKm: Number(km.toFixed(1)), distanceSource:fc.source };
      if(km <= 13) return { type:"gpsMid", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치 기준 접근 가능", distanceKm: Number(km.toFixed(1)), distanceSource:fc.source };
      if(km <= 24) return { type:"gpsFar", label:`약 ${km.toFixed(1)}km`, detail:"화성시 내 이동권 시설", distanceKm: Number(km.toFixed(1)), distanceSource:fc.source };
      return { type:"none", label:`약 ${km.toFixed(1)}km`, detail:"현재 위치와 거리가 있는 시설", distanceKm: Number(km.toFixed(1)), distanceSource:fc.source };
    }
  }
  return { type:"none", label:"조건 기준", detail:"입력한 목적과 조건을 기준으로 추천" };
}
function locationScore(f,userContext){
  const meta = getLocationMeta(f,userContext);
  if(meta.type === "referenceVeryNear") return 70;
  if(meta.type === "referenceNear") return 54;
  if(meta.type === "referenceMid") return 34;
  if(meta.type === "sameDistrict") return 72;
  if(meta.type === "districtVeryNear") return 58;
  if(meta.type === "districtNear") return 42;
  if(meta.type === "sameArea") return 30;
  if(meta.type === "nearArea") return 18;
  if(meta.type === "gpsVeryNear") return 55;
  if(meta.type === "gpsNear") return 38;
  if(meta.type === "gpsMid") return 22;
  if(meta.type === "gpsFar") return 8;
  return 0;
}

function localQueryHints(query){
  const q = String(query || "").replace(/\s/g,"");
  const categories = [];
  const tokens = [];
  const districts = [];
  const explicitAreaMentions = detectAreaMentions(query);
  const explicitDistrictMentions = unique([normalizeDistrictHint(query)].filter(Boolean));
  const dbLimit = classifyDbLimit(query);

  const rules = [
    {words:["축구","풋살","운동","체육","농구","배드민턴","수영"], cats:["체육시설","공원시설","물놀이장"], tokens:["축구","풋살","운동","체육","체육관","수영","구장","운동장"]},
    {words:["도서관","공부","스터디","책","독서","조용"], cats:["도서관","문화시설"], tokens:["도서관","공부","스터디","책","열람실","독서"]},
    {words:["아이","가족","어린이","유아"], cats:["어린이공원","공원시설","도서관","문화시설","물놀이장"], tokens:["아이","가족","어린이","유아","놀이터"]},
    {words:["공원","산책","걷기","자연","맨발"], cats:["공원시설","어린이공원","맨발산책로"], tokens:["공원","산책","걷기","자연","맨발"]},
    {words:["대관","회의","강당","세미나","모임","공간"], cats:["공공시설","문화시설","복지시설","도서관"], tokens:["대관","회의실","강당","공간","다목적"]},
    {words:["문화","공연","행사","축제","전시","데이트"], cats:["문화시설","공연행사","프로그램","공원시설"], tokens:["문화","공연","행사","축제","전시"]},
    {words:["복지","상담","어르신","노인"], cats:["복지시설","공공시설"], tokens:["복지","상담","어르신","노인"]},
    {words:["더워","덥","시원","무더위","폭염","비","실내"], cats:["도서관","문화시설","공공시설","복지시설"], tokens:["도서관","문화시설","실내","쉼터","휴식"]}
  ];
  rules.forEach(r=>{
    if(r.words.some(w=>q.includes(w))){ categories.push(...r.cats); tokens.push(...r.tokens); }
  });

  districts.push(...explicitDistrictMentions);
  districts.push(...explicitAreaMentions);

  return {
    raw:query,
    categories:unique(categories),
    tokens:unique(tokens),
    districts:unique(districts),
    explicitAreaMentions:unique(explicitAreaMentions),
    explicitDistrictMentions,
    lowCrowd:q.includes("혼잡")||q.includes("한산")||q.includes("여유"),
    indoor:q.includes("실내")||q.includes("비")||q.includes("더워")||q.includes("덥")||q.includes("시원")||q.includes("무더위")||q.includes("폭염"),
    reservable:q.includes("예약"),
    near:q.includes("근처")||q.includes("가까")||q.includes("주변")||q.includes("내위치")||q.includes("현재위치"),
    freePreferred:q.includes("무료")||q.includes("돈")||q.includes("요금"),
    dbLimit
  };
}
function scoreFacility(f,intent,userContext){
  const text=[f.name,f.category,f.subCategory,f.district,f.space,f.address,f.fee,...(f.keywords||[])].join(" ");
  const area = getAreaGroup(f.district);
  let score=0;

  (intent.tokens || []).forEach(t=>{ if(text.includes(t)) score += 22; });
  if((intent.categories || []).includes(f.category)) score += 48;
  if((intent.avoidCategories || []).includes(f.category)) score -= 55;

  (intent.districts || []).forEach(d=>{
    if(text.includes(d)) score += 38;
    if(areaGroups[d]?.includes(f.district)) score += 42;
    if(d === area) score += 42;
  });

  if(intent.lowCrowd && f.crowd==="여유") score += 20;
  if(intent.indoor && !["공원시설","어린이공원","맨발산책로","물놀이장"].includes(f.category)) score += 24;
  if(intent.indoor && ["공원시설","어린이공원","맨발산책로"].includes(f.category)) score -= 20;
  if(intent.reservable && f.reservable) score += 12;
  if(intent.freePreferred && f.fee && String(f.fee).includes("무료")) score += 10;

  score += locationScore(f,userContext);
  return score;
}
function buildReasons(f,intent,effectiveUserContext={}){
  const reasons=[];
  const meta = getLocationMeta(f,effectiveUserContext);
  if(effectiveUserContext.mode === "reference" && meta.type !== "none"){
    reasons.push(meta.detail);
  }else if(effectiveUserContext.basisDistrict && f.district === effectiveUserContext.basisDistrict){
    reasons.push(`${effectiveUserContext.basisDistrict} 안에 있는 시설이라 입력한 지역과 가장 직접적으로 맞아요.`);
  }else if(meta.type !== "none"){
    reasons.push(meta.detail);
  }
  if((intent.districts || []).includes(f.district) || (intent.districts || []).includes(getAreaGroup(f.district))) reasons.push("입력한 지역 기준과 맞는 시설입니다.");
  if((intent.categories || []).includes(f.category)) reasons.push(`${f.category} 목적과 잘 맞습니다.`);
  if(intent.lowCrowd && f.crowd==="여유") reasons.push("혼잡도가 낮은 시설입니다.");
  if(intent.indoor && !["공원시설","어린이공원","맨발산책로"].includes(f.category)) reasons.push("실내 또는 우천·더위 상황에서 보기 좋습니다.");
  if(f.reservable) reasons.push("예약 가능 여부를 확인해볼 수 있습니다.");
  if(f.fee && String(f.fee).includes("무료")) reasons.push("무료 또는 저비용으로 이용할 수 있습니다.");
  if(!reasons.length) reasons.push("입력한 목적과 시설 정보가 연결됩니다.");
  return unique(reasons).slice(0,4);
}
function enrich(f,effectiveUserContext={},reasons=[]){
  return {
    ...f,
    areaGroup: getAreaGroup(f.district),
    locationMeta: getLocationMeta(f,effectiveUserContext),
    recommendationReasons: reasons.length ? reasons : buildReasons(f, localQueryHints(""), effectiveUserContext)
  };
}

function searchFacilities(message, analysis, userContext){
  const local = localQueryHints(message);
  const categories = unique([...(analysis.targetCategories || []), ...local.categories]);
  const tokens = unique([...(analysis.keywords || []), ...local.tokens]);
  const districts = unique([...expandDistrictTargets(analysis.targetDistricts || []), ...expandDistrictTargets(local.districts || [])]);
  const constraints = analysis.constraints || {};

  const intent = {
    raw: message,
    categories,
    tokens,
    districts,
    explicitDistrictMentions: local.explicitDistrictMentions || [],
    referenceLocation: userContext.mode === "reference" ? {
      name:userContext.basisPlaceName || null,
      address:userContext.basisAddress || null,
      lat:userContext.referenceLat || null,
      lng:userContext.referenceLng || null
    } : null,
    avoidCategories: analysis.avoidCategories || [],
    lowCrowd: Boolean(constraints.lowCrowd || local.lowCrowd),
    indoor: Boolean(constraints.indoor || local.indoor),
    reservable: Boolean(constraints.reservable || local.reservable),
    near: Boolean(constraints.near || local.near),
    freePreferred: Boolean(constraints.freePreferred || local.freePreferred)
  };

  const scored = facilities
    .map(f=>({...f,_score:scoreFacility(f,intent,userContext), areaGroup:getAreaGroup(f.district), locationMeta:getLocationMeta(f,userContext)}))
    .filter(f=>f._score>0)
    .sort((a,b)=>b._score-a._score)
    .slice(0,18);

  return {intent,candidates:scored};
}
function buildRelated(recs,intent,userContext){
  if(!recs.length) return [];
  const main = recs[0];
  const recIds = new Set(recs.map(f=>Number(f.id)));
  const complementaryByMain = {
    "체육시설":["공원시설","도서관","문화시설","공공시설"],
    "공원시설":["도서관","문화시설","체육시설","어린이공원"],
    "어린이공원":["도서관","공원시설","문화시설","물놀이장"],
    "도서관":["공원시설","문화시설","공공시설","체육시설"],
    "문화시설":["도서관","공원시설","공연행사","프로그램"],
    "공연행사":["문화시설","프로그램","공원시설","도서관"],
    "프로그램":["문화시설","공연행사","도서관","공원시설"]
  };
  const cats = unique([...(complementaryByMain[main.category] || []), ...(intent.categories || []), main.category]);
  return facilities.map(f=>{
      let score=0;
      if(recIds.has(Number(f.id))) return {...f,_score:-1};
      if(f.district===main.district) score+=30;
      if(getAreaGroup(f.district)===getAreaGroup(main.district)) score+=20;
      if(cats.includes(f.category)) score+=20;
      if(f.category !== main.category && cats.includes(f.category)) score+=8;
      score += Math.round(locationScore(f,userContext)*0.5);
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
function contextFacts(f,userContext){
  if(!f) return null;
  const meta = getLocationMeta(f,userContext);
  return {
    id:f.id,
    name:f.name,
    district:f.district,
    areaGroup:getAreaGroup(f.district),
    category:f.category,
    address:f.address || "정보 없음",
    phone:f.phone || "정보 없음",
    hours:f.hours || "확인 필요",
    fee:f.fee || "확인 필요",
    crowd:f.crowd || "정보 없음",
    reservable:Boolean(f.reservable),
    distanceText:meta.distanceKm ? `약 ${meta.distanceKm}km` : meta.detail,
    locationMeta:meta
  };
}
function selectedFactAnswer(message, selected, effectiveUserContext, analysis){
  const q = String(message || "").replace(/\s/g,"");
  const fact = contextFacts(selected,effectiveUserContext);
  if(!fact) return analysis.answerLead || "확인할 시설을 먼저 선택해주세요.";

  if(q.includes("거리") || q.includes("얼마나") || q.includes("몇km") || q.includes("현재위치") || q.includes("내위치")){
    return `${fact.name}까지는 현재 기준으로 ${fact.distanceText} 정도로 볼 수 있어요. 다만 이 거리는 읍면동 대표 좌표를 기준으로 계산한 대략적인 값이에요.`;
  }
  if(q.includes("운영") || q.includes("몇시") || q.includes("시간")){
    return `${fact.name}의 운영시간은 현재 DB 기준으로 ${fact.hours}입니다. 방문 전 공식 안내나 전화로 한 번 더 확인하는 걸 권장드려요.`;
  }
  if(q.includes("요금") || q.includes("무료") || q.includes("비용") || q.includes("돈")){
    return `${fact.name}의 요금 정보는 현재 DB 기준으로 ${fact.fee}입니다.`;
  }
  if(q.includes("예약")){
    return `${fact.name}은 예약 여부를 확인해보는 것이 좋아요. 상세정보의 예약 / 이용 안내 버튼을 통해 확인하는 흐름으로 연결할 수 있습니다.`;
  }
  if(q.includes("주소") || q.includes("위치")){
    return `${fact.name}의 주소는 ${fact.address}입니다.`;
  }
  if(q.includes("전화") || q.includes("연락")){
    return `${fact.name}의 전화번호는 ${fact.phone}입니다.`;
  }
  return analysis.answerLead || `${fact.name}에 대해 확인해드릴게요. 주소, 전화번호, 운영시간, 요금, 예약 여부를 상세정보에서 볼 수 있어요.`;
}
function makeNaturalAnswer(message, analysis, recs, userContext){
  const lead = String(analysis.answerLead || "").trim();
  if(!recs.length){
    return polishAnswer(lead || "말씀하신 상황은 이해했지만, 현재 H-MATE 시설 DB에서 바로 추천할 수 있는 시설을 찾지 못했어요. 화성시 안의 지역이나 이용 목적을 조금 더 구체적으로 알려주시면 다시 찾아볼게요.");
  }

  const first = recs[0];
  const area = getAreaGroup(first.district);
  const basis = analysis.recommendationBasis || "입력한 목적";
  const safeLead = lead || "말씀하신 상황을 기준으로 화성시 공공시설을 찾아봤어요.";

  let basisText = "";
  if(basis === "home_area") basisText = "집 근처로 언급한 지역을 기준으로";
  else if(basis === "destination_area") basisText = "목적지로 언급한 지역을 기준으로";
  else if(basis === "selected_area") basisText = "선택한 권역을 기준으로";
  else if(basis === "gps") basisText = "현재 위치를 기준으로";
  else if(basis === "mentioned_area") basisText = "입력한 화성시 지역을 기준으로";
  else basisText = "입력한 목적을 기준으로";

  return polishAnswer(`${safeLead}<br>${basisText} ${area} 안에서 이용하기 좋은 시설을 우선 골라봤어요. 가장 먼저 볼 만한 곳은 <b>${first.name}</b>입니다.`);
}

function buildLocalOnlyAnalysis(message){
  const local = localQueryHints(message);
  const addr = extractAddressCandidate(message);
  const place = extractPlaceCandidate(message);
  const targetLocationText = addr || place || "none";
  const targetLocationType = addr ? "address" : (place ? "place" : "none");
  return {
    requestType:"recommend",
    canRecommend:true,
    mainIntent: local.tokens?.length ? local.tokens.join(", ") : "공공시설 추천",
    contextSummary:"사용자 문장과 현재 위치 정보를 기준으로 시설을 찾습니다.",
    recommendationBasis: targetLocationText !== "none" ? "reference_location" : "purpose_only",
    targetCategories:local.categories,
    avoidCategories:[],
    targetDistricts:local.districts,
    targetLocationText,
    targetLocationType,
    keywords:local.tokens,
    missingData:[],
    constraints:{
      near:local.near,
      indoor:local.indoor,
      lowCrowd:local.lowCrowd,
      reservable:local.reservable,
      freePreferred:local.freePreferred
    },
    answerLead:"말씀하신 조건을 기준으로 화성시 시설 DB에서 찾아봤어요.",
    followUpSuggestions:["거리 보기","운영시간","예약 여부"]
  };
}
async function smartFallback(message,userContext={}, reason="fallback"){
  const local = localQueryHints(message);
  const analysis = buildLocalOnlyAnalysis(message);
  const kakaoLocation = await resolveKakaoLocation(message, analysis, local);
  const resolved = resolveRecommendationContext(userContext, analysis, local, kakaoLocation);
  const effectiveUserContext = resolved.userContext;
  analysis.recommendationBasis = resolved.usedBasis === "outside_gps_no_area" ? analysis.recommendationBasis : resolved.usedBasis;

  const {intent,candidates} = searchFacilities(message,analysis,effectiveUserContext);
  const recs = candidates.slice(0,3).map(f=>enrich(f,effectiveUserContext,buildReasons(f,intent,effectiveUserContext)));
  const related = buildRelated(recs,intent,effectiveUserContext);

  if(!recs.length){
    return {
      mode:"system_fallback",
      responseType:"db_gap",
      answer:kakaoLocation
        ? `${kakaoLocation.name || kakaoLocation.originalText} 주변 기준 위치는 확인했지만, 현재 시설 DB에서 바로 연결되는 추천 시설을 찾지 못했어요.`
        : "현재 H-MATE 시설 DB만으로는 바로 추천하기 어려운 요청이에요. 공원, 도서관, 체육시설, 문화시설처럼 등록된 공공시설 범위 안에서 다시 물어보시면 더 정확히 안내드릴게요.",
      summary:"현재 DB에서 직접 추천 가능한 시설이 없습니다.",
      intent,
      selectedFacility:null,
      recommendations:[],
      related:[],
      suggestions:["도서관 추천","공원 추천","체육시설 추천"],
      analysis:{...analysis, locationResolution:resolved, referenceLocation:kakaoLocation || null, fallbackReason:reason}
    };
  }

  return {
    mode:"system_fallback",
    responseType:"recommend",
    answer:polishAnswer(makeNaturalAnswer(message,analysis,recs,effectiveUserContext)),
    summary:kakaoLocation ? `${kakaoLocation.name || kakaoLocation.originalText} 기준으로 가까운 시설을 우선 추천했습니다.` : "화성시 시설 DB를 기준으로 목적과 지역을 반영해 추천했습니다.",
    intent,
    selectedFacility:null,
    recommendations:recs,
    related,
    suggestions:["거리 보기","운영시간","예약 여부"],
    analysis:{...analysis, locationResolution:resolved, referenceLocation:kakaoLocation || null, fallbackReason:reason}
  };
}

function fallback(message,userContext){
  const local = localQueryHints(message);
  const fakeAnalysis = {
    requestType:"recommend",
    targetCategories:local.categories,
    targetDistricts:local.districts,
    keywords:local.tokens,
    avoidCategories:[],
    constraints:{
      near:local.near,
      indoor:local.indoor,
      lowCrowd:local.lowCrowd,
      reservable:local.reservable,
      freePreferred:local.freePreferred
    },
    answerLead:"말씀하신 조건을 기준으로 화성시 시설 DB에서 찾아봤어요.",
    recommendationBasis:"mentioned_area"
  };
  const {intent,candidates} = searchFacilities(message,fakeAnalysis,userContext);
  const recs = candidates.slice(0,3).map(f=>enrich(f,userContext,buildReasons(f,intent,userContext)));
  const related = buildRelated(recs,intent,userContext);

  if(!recs.length){
    return {
      mode:"system_fallback",
      responseType:"db_gap",
      answer:"현재 H-MATE 시설 DB만으로는 바로 추천하기 어려운 요청이에요. 공원, 도서관, 체육시설, 문화시설처럼 등록된 공공시설 범위 안에서 다시 물어보시면 더 정확히 안내드릴게요.",
      summary:"현재 DB에서 직접 추천 가능한 시설이 없습니다.",
      intent,
      recommendations:[],
      related:[],
      suggestions:["도서관 추천","공원 추천","체육시설 추천"]
    };
  }

  return {
    mode:"system_fallback",
    responseType:"recommend",
    answer:makeNaturalAnswer(message,fakeAnalysis,recs,userContext),
    summary:"화성시 시설 DB를 기준으로 목적과 지역을 반영해 추천했습니다.",
    intent,
    recommendations:recs,
    related,
    suggestions:["거리 보기","운영시간","예약 여부"]
  };
}

async function analyzeContextWithAI(client, {message, userContext, selected, history}){
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    max_output_tokens: 900,
    input: [
      {
        role:"system",
        content:[
          "너는 H-MATE의 AI 큐레이터다.",
          "사용자의 현재 문장뿐 아니라 최근 대화 맥락을 함께 읽고 진짜 의도와 추천 기준을 판단한다.",
          "추천 기준 우선순위는 현재 문장에서 직접 말한 정확한 읍면동 > 현재 문장에서 직접 말한 권역/생활지명 > 대화 맥락의 집/목적지/가려는 곳 > 선택 권역 > GPS 현재 위치 > 목적 중심이다.",
          "동탄6동, 동탄 6동, 향남읍, 봉담읍처럼 정확한 읍면동이 나오면 넓은 권역으로 뭉개지 말고 그 읍면동 기준으로 판단한다.",
          "10용사로 286 같은 주소, 푸른초·병점역·동탄 남광장 같은 장소명은 targetLocationText에 그대로 추출한다. 지도 API로 좌표를 찾을 수 있게 주소/장소명만 짧게 넣는다.",
          "targetLocationText가 없으면 문자열 none을 넣고, targetLocationType은 none으로 둔다.",
          "사용자가 사는 곳, 일하는 곳, 퇴근길, 집 근처, 목적지, 현재 위치 허용 여부 같은 생활 맥락을 해석한다.",
          "H-MATE는 화성시 공공시설 DB 안에서만 추천한다. DB 밖 시설명, 주소, 전화, 운영시간은 지어내지 않는다.",
          "민간 식당/카페/맛집은 현재 DB 범위 밖이다. 다만 식사 후 운동/독서처럼 공공시설 추천과 연결되는 목적은 추천 가능하다.",
          "공공화장실처럼 별도 DB가 없는 생활서비스는 db_gap으로 판단한다.",
          "오늘/이번 주말처럼 실시간 일정이 필요한 행사 질문은 실제 일정을 아는 척하지 말고, 실시간 일정은 없지만 관련 문화시설/프로그램 확인 방향으로 안내한다.",
          "딱딱한 표현을 피하고, answerLead에는 사용자의 상황을 자연스럽게 받아주는 한두 문장을 쓴다.",
          "금지 표현: 추천 기준 미설정, 위치 기준 없음, 후보, DB 후보, 위도, 경도. 좌표값을 답변에 직접 말하지 않는다. 현재 위치가 화성시 밖이면 GPS 기준 추천을 고집하지 말고, 사용자가 말한 화성 내 지역이나 선택 권역을 기준으로 삼는다. 화성 내 지역이 없으면 추천보다 지역 확인 질문을 우선한다.",
          "followUpSuggestions는 버튼에 들어갈 짧은 문구만 쓴다. 예: 거리 보기, 운영시간, 예약 여부, 한산한 곳, 다른 시설."
        ].join("\\n")
      },
      {
        role:"user",
        content: JSON.stringify({
          user_message: message,
          recent_history: history.slice(-10),
          user_location_context: sanitizeUserContextForAI(userContext),
          selected_facility: selected ? contextFacts(selected,userContext) : null,
          available_categories: getAllCategories(),
          registered_districts: getAllDistricts(),
          area_groups: Object.keys(areaGroups),
          common_place_aliases: placeAreaAliases,
          db_limits: [
            "화성시 공공시설 중심 DB",
            "식당/카페/맛집 전용 DB 없음",
            "공공화장실 전용 DB 없음",
            "시설별 운영시간/요금/예약 정보는 일부 확인 필요일 수 있음"
          ]
        }, null, 2)
      }
    ],
    text:{
      format:{
        type:"json_schema",
        name:"hmate_context_decision",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          properties:{
            requestType:{type:"string", enum:["recommend","compare","answer_selected","clarify","db_gap","out_of_scope"]},
            canRecommend:{type:"boolean"},
            mainIntent:{type:"string"},
            contextSummary:{type:"string"},
            recommendationBasis:{type:"string", enum:["gps","selected_area","home_area","work_area","destination_area","mentioned_area","mentioned_district","reference_location","purpose_only"]},
            targetCategories:{type:"array", maxItems:6, items:{type:"string"}},
            avoidCategories:{type:"array", maxItems:6, items:{type:"string"}},
            targetDistricts:{type:"array", maxItems:6, items:{type:"string"}},
            targetLocationText:{type:"string"},
            targetLocationType:{type:"string", enum:["none","address","place","district","area","gps_context"]},
            keywords:{type:"array", maxItems:10, items:{type:"string"}},
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
            answerLead:{type:"string"},
            followUpSuggestions:{type:"array", maxItems:3, items:{type:"string"}}
          },
          required:["requestType","canRecommend","mainIntent","contextSummary","recommendationBasis","targetCategories","avoidCategories","targetDistricts","targetLocationText","targetLocationType","keywords","missingData","constraints","answerLead","followUpSuggestions"]
        }
      }
    }
  });

  return {analysis: JSON.parse(response.output_text), usage: response.usage || null};
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
    res.status(200).json(await smartFallback(message,userContext,"no_openai_key"));
    return;
  }

  const selected = referencedFacility(message, selectedFacilityId, lastRecommendationIds, lastRelatedIds);
  const followup = isFollowup(message);

  try{
    const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
    const {analysis, usage} = await analyzeContextWithAI(client, {message, userContext, selected, history});
    const localHints = localQueryHints(message);
    const localAddr = extractAddressCandidate(message);
    const localPlace = extractPlaceCandidate(message);
    if((!analysis.targetLocationText || analysis.targetLocationText === "none") && (localAddr || localPlace)){
      analysis.targetLocationText = localAddr || localPlace;
      analysis.targetLocationType = localAddr ? "address" : "place";
      analysis.recommendationBasis = "reference_location";
    }
    const kakaoLocation = await resolveKakaoLocation(message, analysis, localHints);

    if(localHints.dbLimit?.toilet){
      res.status(200).json({
        mode:"ai",
        responseType:"db_gap",
        answer:"공공화장실 위치는 현재 H-MATE 시설 DB에 따로 들어있지 않아요. 대신 화성시 공공시설, 공원, 도서관, 체육시설처럼 등록된 시설 기준으로는 안내드릴 수 있습니다.",
        summary:"공공화장실 전용 DB가 없어 직접 추천이 어렵습니다.",
        intent:{...localHints, missingData:["공공화장실 전용 위치 DB"]},
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:["근처 공원","도서관 추천","체육시설 추천"],
        analysis:{...analysis, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    if(localHints.dbLimit?.foodOnly){
      res.status(200).json({
        mode:"ai",
        responseType:"db_gap",
        answer:"식당이나 카페 정보는 현재 H-MATE DB 범위 밖이에요. 다만 식사 전후에 들르기 좋은 화성시 공공시설이나 산책·운동·독서 공간은 추천드릴 수 있습니다.",
        summary:"식당/카페 전용 DB가 없어 직접 추천이 어렵습니다.",
        intent:{...localHints, missingData:["식당/카페 DB"]},
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:["산책할 곳","운동할 곳","도서관 추천"],
        analysis:{...analysis, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    if(localHints.dbLimit?.realtimeEvent){
      analysis.canRecommend = true;
      analysis.requestType = "recommend";
      analysis.targetCategories = unique([...(analysis.targetCategories || []), "문화시설", "공연행사", "프로그램"]);
      analysis.keywords = unique([...(analysis.keywords || []), "행사", "공연", "전시", "프로그램", "문화"]);
      analysis.answerLead = "실시간 행사 일정까지는 현재 DB에서 바로 확인하기 어렵지만, 말씀하신 지역을 기준으로 행사나 프로그램을 확인해볼 만한 공공·문화시설을 찾아볼게요.";
    }

    const resolved = resolveRecommendationContext(userContext, analysis, localHints, kakaoLocation);
    const effectiveUserContext = resolved.userContext;

    if(
      resolved.needsAreaClarification &&
      ["recommend","compare","clarify"].includes(analysis.requestType) &&
      !isFollowup(message)
    ){
      res.status(200).json({
        mode:"ai",
        responseType:"clarify",
        answer:polishAnswer(outsideGpsClarifyAnswer(message, analysis, resolved.gpsStatus)),
        summary:"현재 위치가 화성시 밖으로 보여 화성시 내 기준 지역 확인이 필요합니다.",
        intent:{
          raw:message,
          categories:analysis.targetCategories || localHints.categories || [],
          tokens:analysis.keywords || localHints.tokens || [],
          districts:[],
          lowCrowd:Boolean(analysis.constraints?.lowCrowd || localHints.lowCrowd),
          indoor:Boolean(analysis.constraints?.indoor || localHints.indoor),
          reservable:Boolean(analysis.constraints?.reservable || localHints.reservable),
          near:Boolean(analysis.constraints?.near || localHints.near),
          freePreferred:Boolean(analysis.constraints?.freePreferred || localHints.freePreferred),
          missingData:["화성시 내 기준 지역"]
        },
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:["동탄 기준","병점 기준","봉담 기준"],
        analysis:{...analysis, recommendationBasis:"outside_gps_no_area", locationResolution:resolved, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    analysis.recommendationBasis = resolved.usedBasis === "outside_gps_no_area" ? analysis.recommendationBasis : resolved.usedBasis;

    if(analysis.requestType === "answer_selected" && selected){
      const answer = selectedFactAnswer(message, selected, effectiveUserContext, analysis);
      const selectedEnriched = enrich(selected,effectiveUserContext,buildReasons(selected,localQueryHints(message),effectiveUserContext));
      const lastRecs = unique(lastRecommendationIds.map(Number))
        .map(findFacilityById)
        .filter(Boolean)
        .slice(0,3)
        .map(f=>enrich(f,effectiveUserContext,buildReasons(f,localQueryHints(message),effectiveUserContext)));
      res.status(200).json({
        mode:"ai",
        responseType:"answer_selected",
        answer:polishAnswer(answer),
        summary:analysis.contextSummary,
        intent:localQueryHints(message),
        selectedFacility:selectedEnriched,
        recommendations:lastRecs.length ? lastRecs : [selectedEnriched],
        related:buildRelated(lastRecs.length ? lastRecs : [selectedEnriched], localQueryHints(message), effectiveUserContext),
        suggestions:analysis.followUpSuggestions?.length ? analysis.followUpSuggestions : ["거리 보기","운영시간","예약 여부"],
        analysis:{...analysis, locationResolution:resolved || null, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    if(!analysis.canRecommend || ["clarify","db_gap","out_of_scope"].includes(analysis.requestType)){
      res.status(200).json({
        mode:"ai",
        responseType:analysis.requestType,
        answer:polishAnswer(analysis.answerLead),
        summary:analysis.contextSummary,
        intent:{
          raw:message,
          categories:analysis.targetCategories || [],
          tokens:analysis.keywords || [],
          districts:expandDistrictTargets(analysis.targetDistricts || []),
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
        analysis:{...analysis, locationResolution:resolved || null, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    const {intent,candidates} = searchFacilities(message,analysis,effectiveUserContext);
    const recs = candidates.slice(0,3).map(f=>enrich(f,effectiveUserContext,buildReasons(f,intent,effectiveUserContext)));
    const related = buildRelated(recs,intent,effectiveUserContext);
    const responseType = analysis.requestType === "compare" ? "compare" : "recommend";

    if(!recs.length){
      res.status(200).json({
        mode:"ai",
        responseType:"db_gap",
        answer:polishAnswer(analysis.answerLead || "말씀하신 상황은 이해했지만, 현재 H-MATE 시설 DB에서 바로 추천할 수 있는 시설을 찾지 못했어요."),
        summary:analysis.contextSummary,
        intent,
        selectedFacility:null,
        recommendations:[],
        related:[],
        suggestions:analysis.followUpSuggestions?.length ? analysis.followUpSuggestions : ["도서관 추천","공원 추천","체육시설 추천"],
        analysis:{...analysis, locationResolution:resolved || null, referenceLocation:kakaoLocation || null},
        usage:{decision:usage}
      });
      return;
    }

    res.status(200).json({
      mode:"ai",
      responseType,
      answer:polishAnswer(makeNaturalAnswer(message,analysis,recs,effectiveUserContext)),
      summary:analysis.contextSummary,
      intent,
      selectedFacility:null,
      recommendations:recs,
      related,
      suggestions:analysis.followUpSuggestions?.length ? analysis.followUpSuggestions : ["거리 보기","운영시간","예약 여부"],
      analysis:{...analysis, locationResolution:resolved || null, referenceLocation:kakaoLocation || null},
      usage:{decision:usage}
    });
  }catch(err){
    console.error(err);
    res.status(200).json(await smartFallback(message,userContext,"api_error"));
  }
}
