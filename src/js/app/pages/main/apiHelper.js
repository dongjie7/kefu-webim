var utils = require("@/common/utils");
var _const = require("@/common/const");
var emajax = require("@/common/ajax");
var Transfer = require("@/common/transfer");
var profile = require("@/app/tools/profile");
var commonConfig = require("@/common/config");

// 以下调用会缓存参数
// getVisitorId
// getProjectId
// getToken

var cache = {
	appraiseTags: {}
};
var cachedApiCallbackTable = {};
var apiTransfer;

function initApiTransfer(){
	apiTransfer = new Transfer("cross-origin-iframe", "data", true);

	apiTransfer.listen(function(msg){
		var apiName = msg.call;
		var timestamp = msg.timespan;
		var isSuccess = msg.status === 0;
		var callbacks;
		var successCallback;
		var errorCallback;

		if(cachedApiCallbackTable[apiName] && cachedApiCallbackTable[apiName][timestamp]){

			callbacks = cachedApiCallbackTable[apiName][timestamp];
			delete cachedApiCallbackTable[apiName][timestamp];

			successCallback = callbacks.success;
			errorCallback = callbacks.error;

			if(isSuccess){
				typeof successCallback === "function" && successCallback(msg);
			}
			else{
				typeof errorCallback === "function" && errorCallback(msg);
			}
		}
	}, ["api"]);
}

function api(apiName, data, success, error){
	var uuid = utils.uuid();

	// cache
	cachedApiCallbackTable[apiName] = cachedApiCallbackTable[apiName] || {};

	cachedApiCallbackTable[apiName][uuid] = {
		success: success,
		error: error
	};

	apiTransfer.send({
		api: apiName,
		data: data,
		timespan: uuid,
		// 标记postMessage使用object，47.9 增加
		useObject: true
	});
}

function getCurrentServiceSession(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getCurrentServiceSession", {
			tenantId: config.tenantId,
			orgName: config.orgName,
			appName: config.appName,
			imServiceNumber: config.toUser,
			id: config.user.username
		}, function(msg){
			resolve(msg.data);
		}, function(err){
			reject(err);
		});
	});
}

function getToken(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		var token = profile.imToken;

		// 超时降级
		setTimeout(function(){
			if(profile.imToken === null){
				profile.imToken = "";
				resolve("");
			}
		}, 5000);
		if(token !== null || profile.imRestDown){
			resolve(token);
			return;
		}
		emajax({
			url: location.protocol + "//" + config.restServer + "/" + config.orgName +
				"/" + config.appName + "/token",
			useXDomainRequestInIE: true,
			dataType: "json",
			data: {
				grant_type: "password",
				username: config.user.username,
				password: config.user.password
			},
			type: "POST",
			success: function(resp){
				var token = resp.access_token;

				// cache token
				profile.imToken = token;
				resolve(token);
			},
			error: function(err){
				if(err.error_description === "user not found"){
					reject(err);
				}
				else{
					// 未知错误降级走第二通道
					profile.imToken = "";
					resolve("");
				}
			}
		});
	});
}
function getNotice(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(config.isWebChannelConfig){
			resolve(config.notice);
		}
		else{
			api("getSlogan", {
				tenantId: config.tenantId
			}, function(msg){
				var content = utils.getDataByPath(msg, "data.0.optionValue");
				var notice = {
					enabled: !!content,
					content: content
				};
				resolve(notice);
			}, function(err){
				reject(err);
			});
		}
	});
}
function getTheme(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(config.isWebChannelConfig){
			resolve(config.themeName);
		}
		else{
			api("getTheme", {
				tenantId: config.tenantId
			}, function(msg){
				var themeName = utils.getDataByPath(msg, "data.0.optionValue");
				resolve(themeName);
			}, function(err){
				reject(err);
			});
		}
	});
}
function getConfig(configId){
	return new Promise(function(resolve, reject){
		api("getConfig", {
			configId: configId
		}, function(msg){
			var entity = utils.getDataByPath(msg, "data.entity");
			resolve(entity);
		}, function(err){
			reject(err);
		});
	});
}
function getProjectId(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(cache.projectId){
			resolve(cache.projectId);
		}
		else{
			getToken().then(function(token){
				api("getProject", {
					tenantId: config.tenantId,
					"easemob-target-username": config.toUser,
					"easemob-appkey": config.appKey.replace("#", "%23"),
					"easemob-username": config.user.username,
					headers: { Authorization: "Easemob IM " + token }
				}, function(msg){
					var projectId = utils.getDataByPath(msg, "data.entities.0.id");
					if(projectId){
						// cache projectId
						cache.projectId = projectId;
						resolve(projectId);
					}
					else{
						reject(new Error("no project id exist."));
					}
				}, function(err){
					reject(err);
				});
			});
		}
	});
}

function getNoteCategories(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getToken(),
			getProjectId()
		]).then(function(result){
			var token = result[0];
			var projectId = result[1];

			api("getNoteCategories", {
				tenantId: config.tenantId,
				"easemob-target-username": config.toUser,
				"easemob-appkey": config.appKey.replace("#", "%23"),
				"easemob-username": config.user.username,
				headers: { Authorization: "Easemob IM " + token },
				projectId: projectId,
			}, function(msg){
				var list = utils.getDataByPath(msg, "data.entities");
				resolve(list);

			}, function(err){
				reject(err);
			});
		});
	});
}

function createTicket(opt){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("createTicket", {
			tenantId: config.tenantId,
			"easemob-target-username": config.toUser,
			"easemob-appkey": config.appKey.replace("#", "%23"),
			"easemob-username": config.user.username,
			origin_type: "webim",
			headers: { Authorization: "Easemob IM " + opt.token },
			projectId: opt.projectId,
			subject: "",
			content: opt.content,
			status_id: "",
			priority_id: "",
			category_id: opt.category_id,
			session_id: opt.session_id,
			creator: {
				name: opt.name,
				avatar: "",
				email: opt.mail,
				phone: opt.phone,
				qq: "",
				company: "",
				description: ""
			},
			attachments: null
		}, function(msg){
			if(utils.getDataByPath(msg, "data.id")){
				resolve();
			}
			else{
				reject(new Error("unknown error."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function getVisitorId(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(cache.visitorId){
			resolve(cache.visitorId);
		}
		else{
			getToken().then(function(token){
				api("getVisitorInfo", {
					tenantId: config.tenantId,
					orgName: config.orgName,
					appName: config.appName,
					userName: config.user.username,
					imServiceNumber: config.toUser,
					token: token
				}, function(msg){
					var visitorId = utils.getDataByPath(msg, "data.entity.userId");
					if(visitorId){
						// cache visitor id
						cache.visitorId = visitorId;
						resolve(visitorId);
					}
					else{
						reject(_const.ERROR_MSG.VISITOR_DOES_NOT_EXIST);
					}
				}, function(err){
					reject(err);
				});
			});
		}
	});
}

function getOfficalAccounts(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("getOfficalAccounts", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				visitorId: visitorId,
				token: token
			}, function(msg){
				var list = utils.getDataByPath(msg, "data.entities");
				if(_.isArray(list)){
					resolve(list);
				}
				else{
					resolve([]);
					console.error("unexpect data format: ", list);
				}
			}, function(err){
				reject(err);
			});
		})
		// 未创建会话时 visitor不存在，此时 getVisitorId 会reject 特定error，需要捕获此错误
		["catch"](function(err){
			reject(err);
		});
	});
}

function getOfficalAccountMessage(officialAccountId, startId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("getOfficalAccountMessage", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				token: token,
				visitorId: visitorId,
				officialAccountId: officialAccountId,
				direction: "before",
				size: _const.GET_HISTORY_MESSAGE_COUNT_EACH_TIME,
				startId: startId
			}, function(msg){
				var list = utils.getDataByPath(msg, "data.entities");
				if(_.isArray(list)){
					resolve(list);
				}
				else{
					reject(new Error("unexpect data format."));
				}
			}, function(err){
				reject(err);
			});
		})
		["catch"](function(err){
			reject(err);
		});
	});
}

// 获取上下班状态，false 代表上班，true 代表下班
function getDutyStatus(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve/* , reject */){
		api("getDutyStatus_2", {
			channelType: "easemob",
			originType: "webim",
			channelId: config.channelId,
			tenantId: config.tenantId,
			queueName: config.emgroup,
			agentUsername: config.agentName,
			timeScheduleId: config.timeScheduleId,
		}, function(msg){
			resolve(!utils.getDataByPath(msg, "data.entity"));
		}, function(err){
			console.error("unable to get duty state: ", err);
			// 获取状态失败则置为上班状态
			resolve(true);
		});
	});
}

function getGrayList(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve/* , reject */){
		api("grayScale", {
			tenantId: config.tenantId,
		}, function(msg){
			var grayScaleDescription = utils.getDataByPath(msg, "data.entities") || [];
			var grayScaleList = _.chain(grayScaleDescription)
			.map(function(item){
				var keyName = item.grayName;
				var status = item.status;
				var enable = status !== "Disable";

				return [keyName, enable];
			})
			.object()
			.value();

			resolve(grayScaleList);
		}, function(err){
			console.error("unable to get gray list: ", err);
			// 获取失败返回空对象
			resolve({});
		});
	});
}

function getRobertGreeting(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getRobertGreeting_2", {
			channelType: "easemob",
			originType: "webim",
			channelId: config.channelId,
			tenantId: config.tenantId,
			agentUsername: config.agentName,
			queueName: config.emgroup
		}, function(msg){
			resolve(msg.data.entity || {});
		}, function(err){
			reject(err);
		});
	});
}

function getRobertIsOpen(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(typeof cache.isRobotOpen === "boolean"){
			resolve(cache.isRobotOpen);
		}
		else{
			api("getRobertIsOpen", {
				channelType: "easemob",
				originType: "webim",
				channelId: config.channelId,
				tenantId: config.tenantId,
				agentUsername: config.agentName,
				queueName: config.emgroup
			}, function(msg){
				var entity = msg.data.entity;

				cache.isRobotOpen = entity;
				resolve(entity);
			}, function(err){
				reject(err);
			});
		}
	});
}

function getSystemGreeting(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getSystemGreeting", {
			tenantId: config.tenantId
		}, function(msg){
			resolve(msg.data);
		}, function(err){
			reject(err);
		});
	});
}

function getExSession(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getExSession_2", {
			username: config.user.username,
			orgName: config.orgName,
			appName: config.appName,
			imServiceNumber: config.toUser,
			channelType: "easemob",
			originType: "webim",
			channelId: config.channelId,
			queueName: config.emgroup,
			agentUsername: config.agentName,
			tenantId: config.tenantId
		}, function(msg){
			var entity = utils.getDataByPath(msg, "data.entity");
			if(entity){
				resolve(entity);
			}
			else{
				reject(new Error("unexpected data format."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function getAgentStatus(agentUserId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		// todo: discard this
		// 没有token 不发送请求 也不报错
		if(!profile.imToken){
			resolve();
			return;
		}

		api("getAgentStatus", {
			tenantId: config.tenantId,
			orgName: config.orgName,
			appName: config.appName,
			agentUserId: agentUserId,
			userName: config.user.username,
			token: profile.imToken,
			imServiceNumber: config.toUser
		}, function(msg){
			resolve(utils.getDataByPath(msg, "data.state"));
		}, function(err){
			reject(err);
		});
	});
}

function getLastSession(officialAccountId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("getLastSession", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				imServiceNumber: config.toUser,
				officialAccountId: officialAccountId,
				userName: config.user.username,
				visitorId: visitorId,
				token: token
			}, function(msg){
				var entity = utils.getDataByPath(msg, "data.entity");
				if(entity){
					resolve(entity);
				}
				else{
					reject(_const.ERROR_MSG.SESSION_DOES_NOT_EXIST);
				}
			}, function(err){
				reject(err);
			});
		})
		// 未创建会话时 visitor不存在，此时 getVisitorId 会reject 特定error，需要捕获此错误
		["catch"](function(err){
			reject(err);
		});
	});
}

function getSkillgroupMenu(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getSkillgroupMenu", {
			tenantId: config.tenantId
		}, function(msg){
			resolve(utils.getDataByPath(msg, "data.entities.0"));
		}, function(err){
			reject(err);
		});
	});
}

function reportVisitorAttributes(sessionId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		getToken().then(function(token){
			api("reportVisitorAttributes", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				imServiceNumber: config.toUser,
				sessionId: sessionId,
				userName: config.user.username,
				referer: document.referrer,
				token: token
			}, function(){
				resolve();
			}, function(err){
				reject(err);
			});
		});
	});
}

function reportPredictMessage(sessionId, content){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("messagePredict_2", {
				sessionId: sessionId,
				visitor_user_id: visitorId,
				content: content,
				timestamp: _.now(),
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				imServiceNumber: config.toUser,
				token: token
			}, function(){
				resolve();
			}, function(err){
				reject(err);
			});
		});
	});
}

function getAgentInputState(sessionId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		getToken().then(function(token){
			api("getAgentInputState", {
				username: config.user.username,
				orgName: config.orgName,
				appName: config.appName,
				tenantId: config.tenantId,
				serviceSessionId: sessionId,
				token: token,
			}, function(msg){
				resolve(msg.data.entity);
			}, function(err){
				reject(err);
			});
		});
	});
}

function getWaitListNumber(sessionId, queueId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getWaitListNumber", {
			tenantId: config.tenantId,
			queueId: queueId,
			serviceSessionId: sessionId
		}, function(msg){
			resolve(msg.data.entity);
		}, function(err){
			reject(err);
		});
	});
}

function getNickNameOption(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getNickNameOption", {
			tenantId: config.tenantId
		}, function(msg){
			var optionValue = utils.getDataByPath(msg, "data.0.optionValue");
			resolve(optionValue === "true");
		}, function(err){
			reject(err);
		});
	});
}

function closeServiceSession(sessionId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		getToken().then(function(token){
			api("closeServiceSession", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				token: token,
				serviceSessionId: sessionId
			}, function(){
				resolve();
			}, function(err){
				reject(err);
			});
		});
	});
}

function createVisitor(specifiedUserName){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("createVisitor", {
			orgName: config.orgName,
			appName: config.appName,
			imServiceNumber: config.toUser,
			tenantId: config.tenantId,
			specifiedUserName: specifiedUserName || ""
		}, function(msg){
			var entity = msg.data;

			if(entity){
				resolve(msg.data);
			}
			else{
				reject(new Error("error when attempt to create webim visitor"));
			}
		}, function(err){
			reject(err);
		});
	});
}

function getPassword(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getPassword2", {
			userId: config.user.username,
			orgName: config.orgName,
			appName: config.appName,
			imServiceNumber: config.toUser,
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var password = utils.getDataByPath(msg, "data.entity.userPassword");

			if(status === "OK"){
				resolve(password);
			}
			else{
				reject(new Error("unable to get password."));
			}
		}, function(err){
			var status = utils.getDataByPath(err, "data.status");
			var errorDescription = utils.getDataByPath(err, "data.errorDescription");

			if(status === "FAIL"){
				if(errorDescription === "IM user create fail."){
					profile.imRestDown = true;
					resolve("");
					return;
				}
				else if(errorDescription === "IM user not found."){
					reject(new Error("im user not found"));
					return;
				}
			}
			reject(new Error("unknown error when get password"));
		});
	});
}

function getRelevanceList(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getRelevanceList", {
			tenantId: config.tenantId
		}, function(msg){
			var relevanceList = msg.data;

			if(_.isArray(relevanceList) && !_.isEmpty(relevanceList)){
				resolve(relevanceList);
			}
			else{
				reject(new Error(__("prompt.no_valid_channel")));
			}
		}, function(err){
			reject(err);
		});
	});
}

function deleteEvent(gid){
	return new Promise(function(resolve, reject){
		api("deleteEvent", {
			userId: gid
		}, function(){
			resolve();
		}, function(err){
			reject(err);
		});
	});
}

function reportEvent(url, userType, userId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("reportEvent", {
			type: "VISIT_URL",
			tenantId: config.tenantId,
			url: url,
			designatedAgent: config.agentName || "",
			userId: {
				type: userType,
				id: userId
			}
		}, function(msg){
			var resp = msg.data;

			if(resp){
				resolve(resp);
			}
			else{
				reject(new Error("unexpected resopnse data."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function receiveMsgChannel(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("receiveMsgChannel", {
			orgName: config.orgName,
			appName: config.appName,
			easemobId: config.toUser,
			tenantId: config.tenantId,
			visitorEasemobId: config.user.username
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var entities = utils.getDataByPath(msg, "data.entities");

			if(status === "OK"){
				resolve(entities);
			}
			else{
				reject(new Error("unexpected response data."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function sendMsgChannel(body, ext){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("sendMsgChannel", {
			from: config.user.username,
			to: config.toUser,
			tenantId: config.tenantId,
			bodies: [body],
			ext: ext,
			orgName: config.orgName,
			appName: config.appName,
			originType: "webim"
		}, function(msg){
			resolve(msg.data);
		}, function(err){
			reject(err);
		});
	});
}

function uploadImgMsgChannel(file){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		getToken().then(function(token){
			api("uploadImgMsgChannel", {
				userName: config.user.username,
				tenantId: config.tenantId,
				file: file,
				auth: "Bearer " + token,
				orgName: config.orgName,
				appName: config.appName,
			}, function(msg){
				resolve(msg.data);
			}, function(err){
				reject(err);
			});
		});
	});
}

function reportMarketingTaskDelivered(marketingTaskId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("reportMarketingTaskDelivered", {
				marketingTaskId: marketingTaskId,
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				token: token,
				visitor_id: visitorId,
			}, function(msg){
				var status = utils.getDataByPath(msg, "data.status");

				if(status === "OK"){
					resolve();
				}
				else{
					reject(new Error("unexpected reaponse status."));
				}
				resolve(msg.data);
			}, function(err){
				reject(err);
			});
		});
	});
}

function reportMarketingTaskOpened(marketingTaskId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("reportMarketingTaskOpened", {
				marketingTaskId: marketingTaskId,
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				token: token,
				visitor_id: visitorId,
			}, function(msg){
				var status = utils.getDataByPath(msg, "data.status");

				if(status === "OK"){
					resolve();
				}
				else{
					reject(new Error("unexpected reaponse status."));
				}
				resolve(msg.data);
			}, function(err){
				reject(err);
			});
		});
	});
}

function reportMarketingTaskReplied(marketingTaskId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];

			api("reportMarketingTaskReplied", {
				marketingTaskId: marketingTaskId,
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				userName: config.user.username,
				token: token,
				visitor_id: visitorId,
			}, function(msg){
				var status = utils.getDataByPath(msg, "data.status");

				if(status === "OK"){
					resolve();
				}
				else{
					reject(new Error("unexpected reaponse status."));
				}
				resolve(msg.data);
			}, function(err){
				reject(err);
			});
		});
	});
}

function getLatestMarketingTask(officialAccountId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		getToken().then(function(token){
			api("getLatestMarketingTask", {
				tenantId: config.tenantId,
				orgName: config.orgName,
				appName: config.appName,
				officialAccountId: officialAccountId,
				userName: config.user.username,
				token: token
			}, function(msg){
				var entity = utils.getDataByPath(msg, "data.entity");
				resolve(entity);
			}, function(err){
				reject(err);
			});
		});
	});
}

function getEvaluationDegrees(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(cache.evaluationDegrees){
			resolve(cache.evaluationDegrees);
		}
		else{
			getToken().then(function(token){
				api("getEvaluationDegrees", {
					tenantId: config.tenantId,
					orgName: config.orgName,
					appName: config.appName,
					userName: config.user.username,
					token: token
				}, function(msg){
					var entities = utils.getDataByPath(msg, "data.entities");
					if(_.isArray(entities)){
						cache.evaluationDegrees = entities;
						resolve(entities);
					}
					else{
						reject(new Error("unexpected reaponse value."));
					}
				}, function(err){
					reject(err);
				});
			});
		}
	});
}

function getAppraiseTags(evaluateId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		if(cache.appraiseTags[evaluateId]){
			resolve(cache.appraiseTags[evaluateId]);
		}
		else{
			getToken().then(function(token){
				api("getAppraiseTags", {
					tenantId: config.tenantId,
					orgName: config.orgName,
					appName: config.appName,
					userName: config.user.username,
					token: token,
					evaluateId: evaluateId
				}, function(msg){
					var entities = utils.getDataByPath(msg, "data.entities");
					if(entities){
						cache.appraiseTags[evaluateId] = entities;
						resolve(entities);
					}
					else{
						reject(new Error("unexpected reaponse value."));
					}
				}, function(err){
					reject(err);
				});
			});
		}
	});
}

function getWechatComponentId(){
	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/weixin/admin/appid",
			type: "GET",
			success: function(id){
				if(id){
					resolve(id);
				}
				else{
					reject(new Error("unexpected response value."));
				}
			},
			error: function(err){
				reject(err);
			}
		});
	});
}

function getWechatProfile(tenantId, appId, code){
	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/weixin/sns/userinfo/" + appId + "/" + code + "?tenantId=" + tenantId,
			type: "GET",
			success: function(resp){
				var parsed;

				try{
					parsed = JSON.parse(resp);
				}
				catch(e){}

				if(parsed){
					resolve(parsed);
				}
				else{
					reject(new Error("unexpected response value."));
				}
			},
			error: function(err){
				reject(err);
			}
		});
	});
}

function createWechatImUser(openId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/webimplugin/visitors/wechat/"
				+ [
					config.tenantId,
					config.orgName,
					config.appName,
					config.toUser,
					openId,
				].join("_")
				+ "?tenantId=" + config.tenantId,
			data: {
				orgName: config.orgName,
				appName: config.appName,
				imServiceNumber: config.toUser
			},
			type: "POST",
			success: function(resp){
				var parsed;

				try{
					parsed = JSON.parse(resp);
				}
				catch(e){}

				if((parsed && parsed.status) === "OK"){
					resolve(parsed.entity);
				}
				else{
					reject();
				}
			},
			error: function(err){
				reject(err);
			}
		});
	});
}

function getCustomEmojiPackages(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getCustomEmojiPackages", { tenantId: config.tenantId }, function(msg){
			var entities = utils.getDataByPath(msg, "data.entities");

			if(_.isArray(entities)){
				resolve(entities);
			}
			else{
				reject(new Error("unexpected emoji package list."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function getCustomEmojiFiles(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getCustomEmojiFiles", { tenantId: config.tenantId }, function(msg){
			var entities = utils.getDataByPath(msg, "data.entities");

			if(_.isArray(entities)){
				resolve(entities);
			}
			else{
				reject(new Error("unexpected emoji package list."));
			}
		}, function(err){
			reject(err);
		});
	});
}

function getSatisfactionTipWord(){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getSatisfactionTipWord", {
			tenantId: config.tenantId
		}, function(msg){
			var tipWord = utils.getDataByPath(msg, "data.entities.0.optionValue") || __("evaluation.rate_my_service");
			resolve(tipWord);
		}, function(){
			// 异常时，满意度提示语为默认提示语，无reject
			var tipWord = __("evaluation.rate_my_service");
			resolve(tipWord);
		});
	});
}

function updateCustomerInfo(data){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		Promise.all([
			getVisitorId(),
			getToken()
		]).then(function(result){
			var visitorId = result[0];
			var token = result[1];
			data.visitorId = visitorId;
			data.tenantId = config.tenantId;
			data.orgName = config.orgName;
			data.appName = config.appName;
			data.userName = config.user.username;
			data.token = token;
			api("updateCustomerInfo", data, function(msg){
				// resolve(msg.data);
			}, function(err){
				// reject(err);
			});
		});
	});
}

function getArticleJson(data){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getArticleJson", {
			media_id: data.media_id,
			tenantId: config.tenantId,
			userId: config.user.userName,
			orgName: config.orgName,
			appName: config.appName,
			token: 0,
		}, function(ret){
			var articles = utils.getDataByPath(ret, "data.entity.articles");
			resolve(articles);
		});
	});
}
// 猜你想说 接口列表
function getGuessList(data){
	var config = commonConfig.getConfig();
	var officialAccount = profile.currentOfficialAccount;
	if(!officialAccount) return;
	return new Promise(function(resolve, reject){
		api("getGuessList", {
			tenantId: config.tenantId,
			sessionId: officialAccount.sessionId,
			robotId: officialAccount.agentId,
			inputValue: data
		}, function(msg){
			resolve(msg);
		});
	});
}

function getStatisfyYes(robotAgentId, satisfactionCommentKey){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/webimplugin/tenants/" + config.tenantId + "/robot-agents/" + robotAgentId + "/satisfaction-comment",
			data: {
				satisfactionCommentKey: satisfactionCommentKey,
				type: 1
			},
			type: "POST",
			success: function(resp){
				var parsed;

				try{
					parsed = JSON.parse(resp);
				}
				catch(e){}

				if((parsed && parsed.status) === "OK"){
					resolve(parsed.entity);
				}
				else{
					reject(parsed);
				}
			},
			error: function(e){
				reject(e);
			}
		});
	});
}
function getStatisfyNo(robotAgentId, satisfactionCommentKey){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/webimplugin/tenants/" + config.tenantId + "/robot-agents/" + robotAgentId + "/satisfaction-comment",
			data: {
				satisfactionCommentKey: satisfactionCommentKey,
				type: 2
			},
			type: "POST",
			success: function(resp){
				var parsed;

				try{
					parsed = JSON.parse(resp);
				}
				catch(e){}

				if((parsed && parsed.status) === "OK"){
					resolve(parsed.entity);
				}
				else{
					reject(parsed);
				}
			},
			error: function(e){
				reject(e);
			}
		});
	});
}

function getSatisfactionCommentTags(robotAgentId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getSatisfactionCommentTags", {
			tenantId: config.tenantId,
			robotAgentId: robotAgentId
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var entities = utils.getDataByPath(msg, "data.entities");
			if(status === "OK"){
				resolve(entities);
			}
			else{
				reject(msg.data);
			}
		}, function(error){
			reject(error);
		});
	});
}
function confirmSatisfaction(robotAgentId, satisfactionCommentKey, selected){
	var config = commonConfig.getConfig();
	var data = {
		satisfactionCommentKey: satisfactionCommentKey,
		type: 2,
	};
	selected && (data.reasonTag = selected);

	return new Promise(function(resolve, reject){
		emajax({
			url: "/v1/webimplugin/tenants/" + config.tenantId + "/robot-agents/" + robotAgentId + "/satisfaction-comment",
			data: data,
			type: "POST",
			success: function(resp){
				var parsed;

				try{
					parsed = JSON.parse(resp);
				}
				catch(e){}

				if((parsed && parsed.status) === "OK"){
					resolve(parsed.entity);
				}
				else{
					reject(parsed);
				}
			},
			error: function(e){
				reject(e);
			}
		});
	});
}
function getFaqList(configId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getFaqList", {
			tenantId: config.tenantId,
			configId: configId
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var entities = utils.getDataByPath(msg, "data.entities");
			if(status === "OK"){
				resolve(entities);
			}
			else{
				reject(msg.data);
			}
		}, function(error){
			reject(error);
		});
	});
}
function getSelfServiceList(configId){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getSelfServiceList", {
			tenantId: config.tenantId,
			configId: configId
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var entities = utils.getDataByPath(msg, "data.entities");
			if(status === "OK"){
				resolve(entities);
			}
			else{
				reject(msg.data);
			}
		}, function(error){
			reject(error);
		});
	});
}

function getFaqOrSelfServiceStatus(configId, type){
	var config = commonConfig.getConfig();
	return new Promise(function(resolve, reject){
		api("getFaqOrSelfServiceStatus", {
			tenantId: config.tenantId,
			configId: configId,
			type: type
		}, function(msg){
			var status = utils.getDataByPath(msg, "data.status");
			var entity = utils.getDataByPath(msg, "data.entity");
			if(status === "OK"){
				resolve(entity);
			}
			else{
				reject(msg.data);
			}
		}, function(error){
			reject(error);
		});
	});
}

module.exports = {
	getCurrentServiceSession: getCurrentServiceSession,
	getToken: getToken,
	getNotice: getNotice,
	getTheme: getTheme,
	getConfig: getConfig,
	getProjectId: getProjectId,
	createTicket: createTicket,
	getVisitorId: getVisitorId,
	getOfficalAccounts: getOfficalAccounts,
	getOfficalAccountMessage: getOfficalAccountMessage,
	getDutyStatus: getDutyStatus,
	getGrayList: getGrayList,
	getRobertGreeting: getRobertGreeting,
	getRobertIsOpen: getRobertIsOpen,
	getSystemGreeting: getSystemGreeting,
	getExSession: getExSession,
	getAgentStatus: getAgentStatus,
	getLastSession: getLastSession,
	getSkillgroupMenu: getSkillgroupMenu,
	getNoteCategories: getNoteCategories,
	reportVisitorAttributes: reportVisitorAttributes,
	reportPredictMessage: reportPredictMessage,
	getAgentInputState: getAgentInputState,
	getWaitListNumber: getWaitListNumber,
	getNickNameOption: getNickNameOption,
	closeServiceSession: closeServiceSession,
	createVisitor: createVisitor,
	getPassword: getPassword,
	getRelevanceList: getRelevanceList,
	deleteEvent: deleteEvent,
	reportEvent: reportEvent,
	receiveMsgChannel: receiveMsgChannel,
	sendMsgChannel: sendMsgChannel,
	uploadImgMsgChannel: uploadImgMsgChannel,
	reportMarketingTaskDelivered: reportMarketingTaskDelivered,
	reportMarketingTaskOpened: reportMarketingTaskOpened,
	reportMarketingTaskReplied: reportMarketingTaskReplied,
	getLatestMarketingTask: getLatestMarketingTask,
	getEvaluationDegrees: getEvaluationDegrees,
	getAppraiseTags: getAppraiseTags,
	getWechatComponentId: getWechatComponentId,
	getWechatProfile: getWechatProfile,
	createWechatImUser: createWechatImUser,
	getCustomEmojiPackages: getCustomEmojiPackages,
	getCustomEmojiFiles: getCustomEmojiFiles,
	getSatisfactionTipWord: getSatisfactionTipWord,
	updateCustomerInfo: updateCustomerInfo,
	getArticleJson: getArticleJson,
	getGuessList: getGuessList,

	initApiTransfer: initApiTransfer,
	getStatisfyYes: getStatisfyYes,
	getStatisfyNo: getStatisfyNo,
	api: api,
	getSatisfactionCommentTags: getSatisfactionCommentTags,
	confirmSatisfaction: confirmSatisfaction,
	getFaqList: getFaqList,
	getSelfServiceList: getSelfServiceList,
	getFaqOrSelfServiceStatus: getFaqOrSelfServiceStatus,

	setCacheItem: function(key, value){
		cache[key] = value;
	},
	clearCacheItem: function(key){
		cache[key] = null;
	}
};