!function(f){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=f();else if("function"==typeof define&&define.amd)define([],f);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).planet=f()}}(function(){return function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){return o(e[i][1][r]||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}({1:[function(require,module,exports){var decode=require("jwt-decode"),storage={};exports.setKey=function(key){storage.key=key},exports.getKey=function(){return storage.key},exports.setToken=function(token){storage.token=token;var claims=decode(token);if(!claims.api_key)throw new Error("Expected api_key in token payload");storage.key=claims.api_key},exports.getToken=function(){return storage.token},exports.clear=function(){storage={}}},{"jwt-decode":16}],2:[function(require,module,exports){var errors=require("./errors"),request=require("./request"),store=require("./auth-store"),urls=require("./urls");exports.login=function(email,password){var config={url:urls.login(),body:{email:email,password:password},withCredentials:!1};return request.post(config).then(function(obj){if(!obj.body||!obj.body.token)throw new errors.UnexpectedResponse("Missing token",obj.response,obj.body);var token=obj.body.token;try{store.setToken(token)}catch(err){throw new errors.UnexpectedResponse("Unable to decode token",obj.response,obj.body)}return token})},exports.logout=function(){store.clear()},exports.setKey=function(key){store.setKey(key)},exports.getKey=store.getKey,exports.setToken=store.setToken,exports.getToken=store.getToken},{"./auth-store":1,"./errors":3,"./request":8,"./urls":12}],3:[function(require,module,exports){function ResponseError(message,response,body){this.message=message,this.response=response,this.body=body,this.stack=(new Error).stack}function BadRequest(){ResponseError.apply(this,arguments)}function Unauthorized(){ResponseError.apply(this,arguments)}function Forbidden(){ResponseError.apply(this,arguments)}function UnexpectedResponse(){ResponseError.apply(this,arguments)}function ClientError(message){this.message=message,this.stack=(new Error).stack}(ResponseError.prototype=new Error).name="ResponseError",(BadRequest.prototype=new ResponseError).name="BadRequest",(Unauthorized.prototype=new ResponseError).name="Unauthorized",(Forbidden.prototype=new ResponseError).name="Forbidden",(UnexpectedResponse.prototype=new ResponseError).name="UnexpectedResponse",(ClientError.prototype=new Error).name="ClientError",exports.ResponseError=ResponseError,exports.BadRequest=BadRequest,exports.Unauthorized=Unauthorized,exports.Forbidden=Forbidden,exports.UnexpectedResponse=UnexpectedResponse,exports.ClientError=ClientError},{}],4:[function(require,module,exports){exports.and=function(filters){return{type:"AndFilter",config:filters}},exports.or=function(filters){return{type:"OrFilter",config:filters}},exports.not=function(filters){return{type:"NotFilter",config:filters}},exports.dates=function(field,range){var config={};for(var key in range)range[key]instanceof Date?config[key]=range[key].toISOString():config[key]=range[key];return{type:"DateRangeFilter",field_name:field,config:config}},exports.geometry=function(field,geometry){return{type:"GeometryFilter",field_name:field,config:geometry}},exports.numbers=function(field,values){return{type:"NumberInFilter",field_name:field,config:values}},exports.range=function(field,range){return{type:"RangeFilter",field_name:field,config:range}},exports.strings=function(field,values){return{type:"StringInFilter",field_name:field,config:values}},exports.permissions=function(values){return{type:"PermissionFilter",config:values}}},{}],5:[function(require,module,exports){exports.auth=require("./auth"),exports.filter=require("./filter"),exports.types=require("./types"),exports.items=require("./items"),exports.searches=require("./searches"),exports.request=require("./request")},{"./auth":2,"./filter":4,"./items":6,"./request":8,"./searches":10,"./types":11}],6:[function(require,module,exports){var pager=require("./pager"),request=require("./request"),urls=require("./urls");exports.search=function(opt){var options=opt||{},config={query:options.query||{},limit:options.limit,terminator:options.terminator};if(config.query._page_size||(config.query._page_size=250),options.filter&&options.types)config.url=urls.quickSearch(),config.method="POST",config.body={filter:options.filter,item_types:options.types};else{if(!options.id)throw new Error("Expected both `filter` and `types` or a serach `id`.");config.url=urls.searches(options.id,"results")}return pager(config,"features",options.each)},exports.get=function(type,id,opt){var options=opt||{},config={url:urls.items(type,id),terminator:options.terminator};return request.get(config).then(function(res){return res.body})}},{"./pager":7,"./request":8,"./urls":12}],7:[function(require,module,exports){var request=require("./request");module.exports=function(config,key,each){var limit="limit"in config?config.limit:1/0,pageSize=config.query&&config.query._page_size,aborted=!1,terminator=config.terminator;return config.terminator=function(abort){terminator&&terminator(function(){aborted=!0,abort()})},new Promise(function(resolve,reject){var all,count=0;each=each||function(array){return all=all?all.concat(array):array,!0},request.request(config).then(function handler(response){var data=response.body[key];count+=data.length;var done=limit<=count;if(done&&(data.length=data.length-(count-limit)),!done&&pageSize&&(done=data.length<pageSize),!aborted){var links=response.body._links||{},more=!done&&!!links._next,next=more?function(){request.get({url:links._next,terminator:config.terminator}).then(handler).catch(reject)}:function(){};if(!1===each(data,more,next))return;!done&&more?next():resolve(all)}}).catch(reject)})}},{"./request":8}],8:[function(require,module,exports){var url=require("url"),assign=require("./util").assign,util=require("./util"),authStore=require("./auth-store"),errors=require("./errors"),promiseWithRetry=require("./retry"),defaultHeaders={accept:"application/json"};function parseConfig(config){var base;if(config.url){var resolved,currentLocation=util.currentLocation();resolved=void 0!==currentLocation?url.resolve(currentLocation.href,config.url):config.url,base=url.parse(resolved,!0)}else base={query:{}};config.query&&(config.path=url.format({pathname:base.pathname||config.pathname||"/",query:assign(base.query,config.query)})),config=assign(base,config);var headers=assign({},defaultHeaders);for(var key in config.headers)headers[key.toLowerCase()]=config.headers[key];if(!config.form&&config.body&&(headers["content-type"]="application/json"),!1!==config.withCredentials){var token=authStore.getToken(),apiKey=authStore.getKey();token?headers.authorization="Bearer "+token:apiKey&&(headers.authorization="api-key "+apiKey)}var options={method:config.method||"GET",headers:headers,url:config.protocol+"//"+config.hostname+(config.port?":"+config.port:"")+config.path};return"withCredentials"in config&&(options.withCredentials=config.withCredentials),options}function createResponseHandler(resolve,reject,info){return function(event){var client=event.target;if(302===client.status){var redirectLocation=client.getResponseHeader("Location");return(client=new XMLHttpRequest).addEventListener("load",createResponseHandler(resolve,reject,info)),client.addEventListener("error",function(){reject(new errors.ClientError("Request failed"))}),void client.open("GET",redirectLocation)}if(info.completed=!0,!info.aborted){var body=null,err=null,data=client.responseText;if(data)try{body=JSON.parse(data)}catch(parseErr){err=new errors.UnexpectedResponse("Trouble parsing response body as JSON: "+data+"\n"+parseErr.stack+"\n",client,data)}(err=function(response,body){var err=null,status=response.status;return 400===status?err=new errors.BadRequest("Bad request",response,body):401===status?err=new errors.Unauthorized("Unauthorized",response,body):403===status?err=new errors.Forbidden("Forbidden",response,body):200<=status&&status<300||(err=new errors.UnexpectedResponse("Unexpected response status: "+status,response)),err}(client,body)||err)?reject(err):resolve({response:client,body:body})}}}function request(config){var options=parseConfig(config),retries="retries"in config?config.retries:10,info={aborted:!1,completed:!1};return promiseWithRetry(retries,function(resolve,reject){var client=new XMLHttpRequest,handler=createResponseHandler(resolve,reject,info);client.addEventListener("load",handler),client.addEventListener("error",function(){reject(new errors.ClientError("Request failed"))});var body=null;config.form?body=config.form:config.body&&(body=JSON.stringify(config.body));try{for(var header in client.open(options.method,options.url),options.headers)client.setRequestHeader(header,options.headers[header]);"withCredentials"in options&&(client.withCredentials=options.withCredentials),client.send(body)}catch(err){return void reject(new errors.ClientError("Request failed: "+err.message))}config.terminator&&config.terminator(function(){info.completed||info.aborted||(info.aborted=!0,client.abort())})})}exports.get=function(config){return"string"==typeof config&&(config={url:config,method:"GET"}),request(config)},exports.post=function(config){return request(assign({method:"POST"},config))},exports.put=function(config){return request(assign({method:"PUT"},config))},exports.del=function(config){return"string"==typeof config&&(config={url:config}),request(assign({method:"DELETE"},config))},exports.parseConfig=parseConfig,exports.request=request},{"./auth-store":1,"./errors":3,"./retry":9,"./util":13,url:21}],9:[function(require,module,exports){module.exports=function(retries,executor){return new Promise(function(resolve,reject){var attempts=0;!function attempt(){var promise=new Promise(executor);promise.then(resolve),promise.catch(function(error){if(retries<=attempts)reject(error);else{var status=error.response&&error.response.status;if(429===status||500<=status){++attempts;var delay=Math.random()*Math.min(2500,100*Math.pow(2,attempts));setTimeout(attempt,delay)}else reject(error)}})}()})}},{}],10:[function(require,module,exports){var pager=require("./pager"),request=require("./request"),urls=require("./urls");exports.create=function(options){if(!options)throw new Error('Searches require "name", "types", and "filter"');var name=options.name;if(!name)throw new Error('Missing search "name"');var types=options.types;if(!types)throw new Error('Missing search "types"');var filter=options.filter;if(!filter)throw new Error('Missing search "filter"');var config={url:urls.searches(),body:{name:name,item_types:types,filter:filter,__daily_email_enabled:!!options.notification}};return request.post(config).then(function(res){return res.body})},exports.get=function(id,options){options=options||{};var config={url:urls.searches(id),terminator:options.terminator};return request.get(config).then(function(res){return res.body})},exports.remove=function(id){return request.del(urls.searches(id)).then(function(){return!0})},exports.search=function(options){options=options||{};var query=Object.assign({search_type:"saved"},options.query),config={url:urls.searches(),query:query,limit:options.limit,terminator:options.terminator};return pager(config,"searches",options.each)},exports.update=function(id,options){if(!options)throw new Error('Missing "name", "types", or "filter"');var search={};options.name&&(search.name=options.name),options.types&&(search.item_types=options.types),options.filter&&(search.filter=options.filter),"notification"in options&&(search.__daily_email_enabled=options.notification);var config={url:urls.searches(id),body:search};return request.put(config).then(function(res){return res.body})}},{"./pager":7,"./request":8,"./urls":12}],11:[function(require,module,exports){var pager=require("./pager"),request=require("./request"),urls=require("./urls");exports.search=function(opt){var options=opt||{},config={url:urls.types(),query:options.query,terminator:options.terminator};return pager(config,"item_types",options.each)},exports.get=function(id,opt){var options=opt||{},config={url:urls.types(id),terminator:options.terminator};return request.get(config).then(function(res){return res.body})}},{"./pager":7,"./request":8,"./urls":12}],12:[function(require,module,exports){var API_URL="https://api.planet.com/";function join(){var components=Array.prototype.map.call(arguments,function(part){if("string"!=typeof part&&"number"!=typeof part)throw new Error("join must be called with strings or numbers, got: "+part);return String(part).replace(/^\/?(.*?)\/?$/,"$1")}),lastComponent=components.pop();return components.filter(function(el){return""!==el}).concat(lastComponent).join("/")}function getter(){var parts=Array.prototype.slice.call(arguments);return function(){return join.apply(null,[API_URL].concat(parts).concat(Array.prototype.slice.call(arguments)))}}exports.setBase=function(base){API_URL=base},exports.base=getter(""),exports.login=getter("auth","v1","experimental","public","users","authenticate"),exports.types=getter("data","v1","item-types",""),exports.items=function(type){var rest=Array.prototype.slice.call(arguments,1);return getter("data","v1","item-types",type,"items","").apply(null,rest)},exports.quickSearch=getter("data","v1","quick-search"),exports.searches=getter("data","v1","searches",""),exports.join=join},{}],13:[function(require,module,exports){var querystring=require("querystring");exports.addQueryParams=function(link,params){var baseHash=link.split("#"),base=baseHash[0],hash=baseHash[1],parts=base.split("?"),search=parts[1]||"",query=querystring.parse(search);for(var name in params)query[name]=params[name];return search=querystring.stringify(query),parts[0]+"?"+search+(hash?"#"+hash:"")},exports.assign=function(){for(var target=arguments[0],i=1,ii=arguments.length;i<ii;++i){var src=arguments[i];for(var key in src)target[key]=src[key]}return target},exports.currentLocation=function(){return"undefined"!=typeof location?location:void 0}},{querystring:20}],14:[function(require,module,exports){function InvalidCharacterError(message){this.message=message}(InvalidCharacterError.prototype=new Error).name="InvalidCharacterError",module.exports="undefined"!=typeof window&&window.atob&&window.atob.bind(window)||function(input){var str=String(input).replace(/=+$/,"");if(str.length%4==1)throw new InvalidCharacterError("'atob' failed: The string to be decoded is not correctly encoded.");for(var bs,buffer,bc=0,idx=0,output="";buffer=str.charAt(idx++);~buffer&&(bs=bc%4?64*bs+buffer:buffer,bc++%4)&&(output+=String.fromCharCode(255&bs>>(-2*bc&6))))buffer="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".indexOf(buffer);return output}},{}],15:[function(require,module,exports){var atob=require("./atob");module.exports=function(str){var output=str.replace(/-/g,"+").replace(/_/g,"/");switch(output.length%4){case 0:break;case 2:output+="==";break;case 3:output+="=";break;default:throw"Illegal base64url string!"}try{return function(str){return decodeURIComponent(atob(str).replace(/(.)/g,function(m,p){var code=p.charCodeAt(0).toString(16).toUpperCase();return code.length<2&&(code="0"+code),"%"+code}))}(output)}catch(err){return atob(output)}}},{"./atob":14}],16:[function(require,module,exports){"use strict";var base64_url_decode=require("./base64_url_decode");function InvalidTokenError(message){this.message=message}(InvalidTokenError.prototype=new Error).name="InvalidTokenError",module.exports=function(token,options){if("string"!=typeof token)throw new InvalidTokenError("Invalid token specified");var pos=!0===(options=options||{}).header?0:1;try{return JSON.parse(base64_url_decode(token.split(".")[pos]))}catch(e){throw new InvalidTokenError("Invalid token specified: "+e.message)}},module.exports.InvalidTokenError=InvalidTokenError},{"./base64_url_decode":15}],17:[function(require,module,exports){(function(global){!function(root){var freeExports="object"==typeof exports&&exports&&!exports.nodeType&&exports,freeModule="object"==typeof module&&module&&!module.nodeType&&module,freeGlobal="object"==typeof global&&global;freeGlobal.global!==freeGlobal&&freeGlobal.window!==freeGlobal&&freeGlobal.self!==freeGlobal||(root=freeGlobal);var punycode,key,maxInt=2147483647,base=36,tMin=1,tMax=26,skew=38,damp=700,initialBias=72,initialN=128,delimiter="-",regexPunycode=/^xn--/,regexNonASCII=/[^\x20-\x7E]/,regexSeparators=/[\x2E\u3002\uFF0E\uFF61]/g,errors={overflow:"Overflow: input needs wider integers to process","not-basic":"Illegal input >= 0x80 (not a basic code point)","invalid-input":"Invalid input"},baseMinusTMin=base-tMin,floor=Math.floor,stringFromCharCode=String.fromCharCode;function error(type){throw new RangeError(errors[type])}function map(array,fn){for(var length=array.length,result=[];length--;)result[length]=fn(array[length]);return result}function mapDomain(string,fn){var parts=string.split("@"),result="";return 1<parts.length&&(result=parts[0]+"@",string=parts[1]),result+map((string=string.replace(regexSeparators,".")).split("."),fn).join(".")}function ucs2decode(string){for(var value,extra,output=[],counter=0,length=string.length;counter<length;)55296<=(value=string.charCodeAt(counter++))&&value<=56319&&counter<length?56320==(64512&(extra=string.charCodeAt(counter++)))?output.push(((1023&value)<<10)+(1023&extra)+65536):(output.push(value),counter--):output.push(value);return output}function ucs2encode(array){return map(array,function(value){var output="";return 65535<value&&(output+=stringFromCharCode((value-=65536)>>>10&1023|55296),value=56320|1023&value),output+=stringFromCharCode(value)}).join("")}function digitToBasic(digit,flag){return digit+22+75*(digit<26)-((0!=flag)<<5)}function adapt(delta,numPoints,firstTime){var k=0;for(delta=firstTime?floor(delta/damp):delta>>1,delta+=floor(delta/numPoints);baseMinusTMin*tMax>>1<delta;k+=base)delta=floor(delta/baseMinusTMin);return floor(k+(baseMinusTMin+1)*delta/(delta+skew))}function decode(input){var out,basic,j,index,oldi,w,k,digit,t,baseMinusT,codePoint,output=[],inputLength=input.length,i=0,n=initialN,bias=initialBias;for((basic=input.lastIndexOf(delimiter))<0&&(basic=0),j=0;j<basic;++j)128<=input.charCodeAt(j)&&error("not-basic"),output.push(input.charCodeAt(j));for(index=0<basic?basic+1:0;index<inputLength;){for(oldi=i,w=1,k=base;inputLength<=index&&error("invalid-input"),codePoint=input.charCodeAt(index++),(base<=(digit=codePoint-48<10?codePoint-22:codePoint-65<26?codePoint-65:codePoint-97<26?codePoint-97:base)||digit>floor((maxInt-i)/w))&&error("overflow"),i+=digit*w,!(digit<(t=k<=bias?tMin:bias+tMax<=k?tMax:k-bias));k+=base)w>floor(maxInt/(baseMinusT=base-t))&&error("overflow"),w*=baseMinusT;bias=adapt(i-oldi,out=output.length+1,0==oldi),floor(i/out)>maxInt-n&&error("overflow"),n+=floor(i/out),i%=out,output.splice(i++,0,n)}return ucs2encode(output)}function encode(input){var n,delta,handledCPCount,basicLength,bias,j,m,q,k,t,currentValue,inputLength,handledCPCountPlusOne,baseMinusT,qMinusT,output=[];for(inputLength=(input=ucs2decode(input)).length,n=initialN,bias=initialBias,j=delta=0;j<inputLength;++j)(currentValue=input[j])<128&&output.push(stringFromCharCode(currentValue));for(handledCPCount=basicLength=output.length,basicLength&&output.push(delimiter);handledCPCount<inputLength;){for(m=maxInt,j=0;j<inputLength;++j)n<=(currentValue=input[j])&&currentValue<m&&(m=currentValue);for(m-n>floor((maxInt-delta)/(handledCPCountPlusOne=handledCPCount+1))&&error("overflow"),delta+=(m-n)*handledCPCountPlusOne,n=m,j=0;j<inputLength;++j)if((currentValue=input[j])<n&&++delta>maxInt&&error("overflow"),currentValue==n){for(q=delta,k=base;!(q<(t=k<=bias?tMin:bias+tMax<=k?tMax:k-bias));k+=base)qMinusT=q-t,baseMinusT=base-t,output.push(stringFromCharCode(digitToBasic(t+qMinusT%baseMinusT,0))),q=floor(qMinusT/baseMinusT);output.push(stringFromCharCode(digitToBasic(q,0))),bias=adapt(delta,handledCPCountPlusOne,handledCPCount==basicLength),delta=0,++handledCPCount}++delta,++n}return output.join("")}if(punycode={version:"1.4.1",ucs2:{decode:ucs2decode,encode:ucs2encode},decode:decode,encode:encode,toASCII:function(input){return mapDomain(input,function(string){return regexNonASCII.test(string)?"xn--"+encode(string):string})},toUnicode:function(input){return mapDomain(input,function(string){return regexPunycode.test(string)?decode(string.slice(4).toLowerCase()):string})}},freeExports&&freeModule)if(module.exports==freeExports)freeModule.exports=punycode;else for(key in punycode)punycode.hasOwnProperty(key)&&(freeExports[key]=punycode[key]);else root.punycode=punycode}(this)}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],18:[function(require,module,exports){"use strict";function hasOwnProperty(obj,prop){return Object.prototype.hasOwnProperty.call(obj,prop)}module.exports=function(qs,sep,eq,options){sep=sep||"&",eq=eq||"=";var obj={};if("string"!=typeof qs||0===qs.length)return obj;var regexp=/\+/g;qs=qs.split(sep);var maxKeys=1e3;options&&"number"==typeof options.maxKeys&&(maxKeys=options.maxKeys);var len=qs.length;0<maxKeys&&maxKeys<len&&(len=maxKeys);for(var i=0;i<len;++i){var kstr,vstr,k,v,x=qs[i].replace(regexp,"%20"),idx=x.indexOf(eq);vstr=0<=idx?(kstr=x.substr(0,idx),x.substr(idx+1)):(kstr=x,""),k=decodeURIComponent(kstr),v=decodeURIComponent(vstr),hasOwnProperty(obj,k)?isArray(obj[k])?obj[k].push(v):obj[k]=[obj[k],v]:obj[k]=v}return obj};var isArray=Array.isArray||function(xs){return"[object Array]"===Object.prototype.toString.call(xs)}},{}],19:[function(require,module,exports){"use strict";function stringifyPrimitive(v){switch(typeof v){case"string":return v;case"boolean":return v?"true":"false";case"number":return isFinite(v)?v:"";default:return""}}module.exports=function(obj,sep,eq,name){return sep=sep||"&",eq=eq||"=",null===obj&&(obj=void 0),"object"==typeof obj?map(objectKeys(obj),function(k){var ks=encodeURIComponent(stringifyPrimitive(k))+eq;return isArray(obj[k])?map(obj[k],function(v){return ks+encodeURIComponent(stringifyPrimitive(v))}).join(sep):ks+encodeURIComponent(stringifyPrimitive(obj[k]))}).join(sep):name?encodeURIComponent(stringifyPrimitive(name))+eq+encodeURIComponent(stringifyPrimitive(obj)):""};var isArray=Array.isArray||function(xs){return"[object Array]"===Object.prototype.toString.call(xs)};function map(xs,f){if(xs.map)return xs.map(f);for(var res=[],i=0;i<xs.length;i++)res.push(f(xs[i],i));return res}var objectKeys=Object.keys||function(obj){var res=[];for(var key in obj)Object.prototype.hasOwnProperty.call(obj,key)&&res.push(key);return res}},{}],20:[function(require,module,exports){"use strict";exports.decode=exports.parse=require("./decode"),exports.encode=exports.stringify=require("./encode")},{"./decode":18,"./encode":19}],21:[function(require,module,exports){"use strict";var punycode=require("punycode"),util=require("./util");function Url(){this.protocol=null,this.slashes=null,this.auth=null,this.host=null,this.port=null,this.hostname=null,this.hash=null,this.search=null,this.query=null,this.pathname=null,this.path=null,this.href=null}exports.parse=urlParse,exports.resolve=function(source,relative){return urlParse(source,!1,!0).resolve(relative)},exports.resolveObject=function(source,relative){return source?urlParse(source,!1,!0).resolveObject(relative):relative},exports.format=function(obj){util.isString(obj)&&(obj=urlParse(obj));return obj instanceof Url?obj.format():Url.prototype.format.call(obj)},exports.Url=Url;var protocolPattern=/^([a-z0-9.+-]+:)/i,portPattern=/:[0-9]*$/,simplePathPattern=/^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,unwise=["{","}","|","\\","^","`"].concat(["<",">",'"',"`"," ","\r","\n","\t"]),autoEscape=["'"].concat(unwise),nonHostChars=["%","/","?",";","#"].concat(autoEscape),hostEndingChars=["/","?","#"],hostnamePartPattern=/^[+a-z0-9A-Z_-]{0,63}$/,hostnamePartStart=/^([+a-z0-9A-Z_-]{0,63})(.*)$/,unsafeProtocol={javascript:!0,"javascript:":!0},hostlessProtocol={javascript:!0,"javascript:":!0},slashedProtocol={http:!0,https:!0,ftp:!0,gopher:!0,file:!0,"http:":!0,"https:":!0,"ftp:":!0,"gopher:":!0,"file:":!0},querystring=require("querystring");function urlParse(url,parseQueryString,slashesDenoteHost){if(url&&util.isObject(url)&&url instanceof Url)return url;var u=new Url;return u.parse(url,parseQueryString,slashesDenoteHost),u}Url.prototype.parse=function(url,parseQueryString,slashesDenoteHost){if(!util.isString(url))throw new TypeError("Parameter 'url' must be a string, not "+typeof url);var queryIndex=url.indexOf("?"),splitter=-1!==queryIndex&&queryIndex<url.indexOf("#")?"?":"#",uSplit=url.split(splitter);uSplit[0]=uSplit[0].replace(/\\/g,"/");var rest=url=uSplit.join(splitter);if(rest=rest.trim(),!slashesDenoteHost&&1===url.split("#").length){var simplePath=simplePathPattern.exec(rest);if(simplePath)return this.path=rest,this.href=rest,this.pathname=simplePath[1],simplePath[2]?(this.search=simplePath[2],this.query=parseQueryString?querystring.parse(this.search.substr(1)):this.search.substr(1)):parseQueryString&&(this.search="",this.query={}),this}var proto=protocolPattern.exec(rest);if(proto){var lowerProto=(proto=proto[0]).toLowerCase();this.protocol=lowerProto,rest=rest.substr(proto.length)}if(slashesDenoteHost||proto||rest.match(/^\/\/[^@\/]+@[^@\/]+/)){var slashes="//"===rest.substr(0,2);!slashes||proto&&hostlessProtocol[proto]||(rest=rest.substr(2),this.slashes=!0)}if(!hostlessProtocol[proto]&&(slashes||proto&&!slashedProtocol[proto])){for(var auth,atSign,hostEnd=-1,i=0;i<hostEndingChars.length;i++){-1!==(hec=rest.indexOf(hostEndingChars[i]))&&(-1===hostEnd||hec<hostEnd)&&(hostEnd=hec)}-1!==(atSign=-1===hostEnd?rest.lastIndexOf("@"):rest.lastIndexOf("@",hostEnd))&&(auth=rest.slice(0,atSign),rest=rest.slice(atSign+1),this.auth=decodeURIComponent(auth)),hostEnd=-1;for(i=0;i<nonHostChars.length;i++){var hec;-1!==(hec=rest.indexOf(nonHostChars[i]))&&(-1===hostEnd||hec<hostEnd)&&(hostEnd=hec)}-1===hostEnd&&(hostEnd=rest.length),this.host=rest.slice(0,hostEnd),rest=rest.slice(hostEnd),this.parseHost(),this.hostname=this.hostname||"";var ipv6Hostname="["===this.hostname[0]&&"]"===this.hostname[this.hostname.length-1];if(!ipv6Hostname)for(var hostparts=this.hostname.split(/\./),l=(i=0,hostparts.length);i<l;i++){var part=hostparts[i];if(part&&!part.match(hostnamePartPattern)){for(var newpart="",j=0,k=part.length;j<k;j++)127<part.charCodeAt(j)?newpart+="x":newpart+=part[j];if(!newpart.match(hostnamePartPattern)){var validParts=hostparts.slice(0,i),notHost=hostparts.slice(i+1),bit=part.match(hostnamePartStart);bit&&(validParts.push(bit[1]),notHost.unshift(bit[2])),notHost.length&&(rest="/"+notHost.join(".")+rest),this.hostname=validParts.join(".");break}}}255<this.hostname.length?this.hostname="":this.hostname=this.hostname.toLowerCase(),ipv6Hostname||(this.hostname=punycode.toASCII(this.hostname));var p=this.port?":"+this.port:"",h=this.hostname||"";this.host=h+p,this.href+=this.host,ipv6Hostname&&(this.hostname=this.hostname.substr(1,this.hostname.length-2),"/"!==rest[0]&&(rest="/"+rest))}if(!unsafeProtocol[lowerProto])for(i=0,l=autoEscape.length;i<l;i++){var ae=autoEscape[i];if(-1!==rest.indexOf(ae)){var esc=encodeURIComponent(ae);esc===ae&&(esc=escape(ae)),rest=rest.split(ae).join(esc)}}var hash=rest.indexOf("#");-1!==hash&&(this.hash=rest.substr(hash),rest=rest.slice(0,hash));var qm=rest.indexOf("?");if(-1!==qm?(this.search=rest.substr(qm),this.query=rest.substr(qm+1),parseQueryString&&(this.query=querystring.parse(this.query)),rest=rest.slice(0,qm)):parseQueryString&&(this.search="",this.query={}),rest&&(this.pathname=rest),slashedProtocol[lowerProto]&&this.hostname&&!this.pathname&&(this.pathname="/"),this.pathname||this.search){p=this.pathname||"";var s=this.search||"";this.path=p+s}return this.href=this.format(),this},Url.prototype.format=function(){var auth=this.auth||"";auth&&(auth=(auth=encodeURIComponent(auth)).replace(/%3A/i,":"),auth+="@");var protocol=this.protocol||"",pathname=this.pathname||"",hash=this.hash||"",host=!1,query="";this.host?host=auth+this.host:this.hostname&&(host=auth+(-1===this.hostname.indexOf(":")?this.hostname:"["+this.hostname+"]"),this.port&&(host+=":"+this.port)),this.query&&util.isObject(this.query)&&Object.keys(this.query).length&&(query=querystring.stringify(this.query));var search=this.search||query&&"?"+query||"";return protocol&&":"!==protocol.substr(-1)&&(protocol+=":"),this.slashes||(!protocol||slashedProtocol[protocol])&&!1!==host?(host="//"+(host||""),pathname&&"/"!==pathname.charAt(0)&&(pathname="/"+pathname)):host=host||"",hash&&"#"!==hash.charAt(0)&&(hash="#"+hash),search&&"?"!==search.charAt(0)&&(search="?"+search),protocol+host+(pathname=pathname.replace(/[?#]/g,function(match){return encodeURIComponent(match)}))+(search=search.replace("#","%23"))+hash},Url.prototype.resolve=function(relative){return this.resolveObject(urlParse(relative,!1,!0)).format()},Url.prototype.resolveObject=function(relative){if(util.isString(relative)){var rel=new Url;rel.parse(relative,!1,!0),relative=rel}for(var result=new Url,tkeys=Object.keys(this),tk=0;tk<tkeys.length;tk++){var tkey=tkeys[tk];result[tkey]=this[tkey]}if(result.hash=relative.hash,""===relative.href)return result.href=result.format(),result;if(relative.slashes&&!relative.protocol){for(var rkeys=Object.keys(relative),rk=0;rk<rkeys.length;rk++){var rkey=rkeys[rk];"protocol"!==rkey&&(result[rkey]=relative[rkey])}return slashedProtocol[result.protocol]&&result.hostname&&!result.pathname&&(result.path=result.pathname="/"),result.href=result.format(),result}if(relative.protocol&&relative.protocol!==result.protocol){if(!slashedProtocol[relative.protocol]){for(var keys=Object.keys(relative),v=0;v<keys.length;v++){var k=keys[v];result[k]=relative[k]}return result.href=result.format(),result}if(result.protocol=relative.protocol,relative.host||hostlessProtocol[relative.protocol])result.pathname=relative.pathname;else{for(var relPath=(relative.pathname||"").split("/");relPath.length&&!(relative.host=relPath.shift()););relative.host||(relative.host=""),relative.hostname||(relative.hostname=""),""!==relPath[0]&&relPath.unshift(""),relPath.length<2&&relPath.unshift(""),result.pathname=relPath.join("/")}if(result.search=relative.search,result.query=relative.query,result.host=relative.host||"",result.auth=relative.auth,result.hostname=relative.hostname||relative.host,result.port=relative.port,result.pathname||result.search){var p=result.pathname||"",s=result.search||"";result.path=p+s}return result.slashes=result.slashes||relative.slashes,result.href=result.format(),result}var isSourceAbs=result.pathname&&"/"===result.pathname.charAt(0),isRelAbs=relative.host||relative.pathname&&"/"===relative.pathname.charAt(0),mustEndAbs=isRelAbs||isSourceAbs||result.host&&relative.pathname,removeAllDots=mustEndAbs,srcPath=result.pathname&&result.pathname.split("/")||[],psychotic=(relPath=relative.pathname&&relative.pathname.split("/")||[],result.protocol&&!slashedProtocol[result.protocol]);if(psychotic&&(result.hostname="",result.port=null,result.host&&(""===srcPath[0]?srcPath[0]=result.host:srcPath.unshift(result.host)),result.host="",relative.protocol&&(relative.hostname=null,relative.port=null,relative.host&&(""===relPath[0]?relPath[0]=relative.host:relPath.unshift(relative.host)),relative.host=null),mustEndAbs=mustEndAbs&&(""===relPath[0]||""===srcPath[0])),isRelAbs)result.host=relative.host||""===relative.host?relative.host:result.host,result.hostname=relative.hostname||""===relative.hostname?relative.hostname:result.hostname,result.search=relative.search,result.query=relative.query,srcPath=relPath;else if(relPath.length)(srcPath=srcPath||[]).pop(),srcPath=srcPath.concat(relPath),result.search=relative.search,result.query=relative.query;else if(!util.isNullOrUndefined(relative.search)){if(psychotic)result.hostname=result.host=srcPath.shift(),(authInHost=!!(result.host&&0<result.host.indexOf("@"))&&result.host.split("@"))&&(result.auth=authInHost.shift(),result.host=result.hostname=authInHost.shift());return result.search=relative.search,result.query=relative.query,util.isNull(result.pathname)&&util.isNull(result.search)||(result.path=(result.pathname?result.pathname:"")+(result.search?result.search:"")),result.href=result.format(),result}if(!srcPath.length)return result.pathname=null,result.search?result.path="/"+result.search:result.path=null,result.href=result.format(),result;for(var last=srcPath.slice(-1)[0],hasTrailingSlash=(result.host||relative.host||1<srcPath.length)&&("."===last||".."===last)||""===last,up=0,i=srcPath.length;0<=i;i--)"."===(last=srcPath[i])?srcPath.splice(i,1):".."===last?(srcPath.splice(i,1),up++):up&&(srcPath.splice(i,1),up--);if(!mustEndAbs&&!removeAllDots)for(;up--;)srcPath.unshift("..");!mustEndAbs||""===srcPath[0]||srcPath[0]&&"/"===srcPath[0].charAt(0)||srcPath.unshift(""),hasTrailingSlash&&"/"!==srcPath.join("/").substr(-1)&&srcPath.push("");var authInHost,isAbsolute=""===srcPath[0]||srcPath[0]&&"/"===srcPath[0].charAt(0);psychotic&&(result.hostname=result.host=isAbsolute?"":srcPath.length?srcPath.shift():"",(authInHost=!!(result.host&&0<result.host.indexOf("@"))&&result.host.split("@"))&&(result.auth=authInHost.shift(),result.host=result.hostname=authInHost.shift()));return(mustEndAbs=mustEndAbs||result.host&&srcPath.length)&&!isAbsolute&&srcPath.unshift(""),srcPath.length?result.pathname=srcPath.join("/"):(result.pathname=null,result.path=null),util.isNull(result.pathname)&&util.isNull(result.search)||(result.path=(result.pathname?result.pathname:"")+(result.search?result.search:"")),result.auth=relative.auth||result.auth,result.slashes=result.slashes||relative.slashes,result.href=result.format(),result},Url.prototype.parseHost=function(){var host=this.host,port=portPattern.exec(host);port&&(":"!==(port=port[0])&&(this.port=port.substr(1)),host=host.substr(0,host.length-port.length)),host&&(this.hostname=host)}},{"./util":22,punycode:17,querystring:20}],22:[function(require,module,exports){"use strict";module.exports={isString:function(arg){return"string"==typeof arg},isObject:function(arg){return"object"==typeof arg&&null!==arg},isNull:function(arg){return null===arg},isNullOrUndefined:function(arg){return null==arg}}},{}]},{},[5])(5)});