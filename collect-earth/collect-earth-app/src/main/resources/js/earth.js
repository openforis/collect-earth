// To be used by the method that saves the data automatically when the user
// interacts with the form
// DO NOT REMOVE
var ajaxTimeout = null;

var ajaxDataUpdate = function() {

	var actively_saved = $("input[id=collect_boolean_actively_saved]").val();
	// Only update automatically when the data has not been correctly saved
	// before
	if (actively_saved == 'false') {
		// Set a two second timeout so that the data is only sent to the server
		// if the user stops clicking for over one second
		clearTimeout(ajaxTimeout);
		ajaxTimeout = setTimeout(function() {
			var $form = $("#formAll");
			var data = serializeForm("formAll");
			$.ajax({
				data : data,
				type : $form.attr("method"),
				url : $form.attr("action"),
				dataType : 'json'
			})
			.done(function(json) {
				interpretJsonSaveResponse(json);
			});
		}, 100);
	}
};
	
var submitForm = function($form, submitCounter) {
	var $form = $("#formAll");
	var data = serializeForm("formAll");
	var request = $
		.ajax({
			data : data,
			type : $form.attr("method"),
			url : $form.attr("action"),
			dataType : 'json',
			timeout : 5000,
			beforeSend : function() {
				$.blockUI({
					message : 'Sumitting data..'
				});
			}
		})
		.done(function(json) {
			interpretJsonSaveResponse(json);
		})
		.fail(
				function(jqXHR, textStatus, errorThrown) {
					if (submitCounter < 3) {
						submitCounter = submitCounter + 1;
						submitForm($form, submitCounter);
					} else {
						$('#succ_mess')
								.css("color", "red")
								.html(
										"Cannot save the data, the Collect Earth server is not running! ");
						$("#dialogSuccess").dialog("open");
					}
				}).always(function() {
			$.unblockUI();
		});
}

var interpretJsonSaveResponse = function(json) {
	if (json.type == 'warning') {
		$('#succ_mess').css("color", "yellow").html(json.message);
	} else if (json.type == 'success' && json.valid_data
			&& json.valid_data == 'false') {

		var message = "";

		$.each(json, function(key, info) {
			if (info.inError) {
				message += info.errorMessage + "<br>";
			}
		});

		$('#succ_mess').css("color", "red").html(message);

		// Resest the "actively saved" parameter to false so that it is not sent
		// aw true when the user fixes the validation
		$("input[id=collect_boolean_actively_saved]").val('false');

	} else if (json.type == 'success') {
		$('#succ_mess').css("color", "green").html(json.message);
		forceWindowCloseAfterDialogCloses($("#dialogSuccess"));
	} else if (json.type == 'error') {
		$('#succ_mess').css("color", "red").html(json.message);
	}
	$("#dialogSuccess").dialog("open");
	
	//update possible values in SELECT elements
	$.each(json.inputFieldInfoByParameterName, function(key, info) {
		var el = $("#" + key);
		if (el && el.length == 1 && el[0].nodeName == "SELECT") {
			var oldValue = el.val();
			var possibleItems = info.possibleCodedItems ? info.possibleCodedItems: [];
			OF.UI.Forms.populateSelect(el, possibleItems, "code", "label");
			el.val(oldValue);
			if (el.val() == null) {
				el.val("-1");
			}
		}
	});

};

var serializeForm = function(formId) {
	return $("#" + formId).serialize();
}

var enableSelect = function(selectName, enable) { // #elementsCover
	if (enable == true) {
		$(selectName).prop('disabled', false);
	} else {
		$(selectName).prop('disabled', true);
	}
	// $(selectName).selectpicker('refresh');
}
