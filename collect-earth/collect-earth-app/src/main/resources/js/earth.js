var SEPARATOR_MULTIPLE_PARAMETERS = "===";
var SEPARATOR_MULTIPLE_VALUES = ";";
var DATE_FORMAT = 'MM/DD/YYYY';
var TIME_FORMAT = 'HH:ss';

//To be used by the method that saves the data automatically when the user
//interacts with the form
//DO NOT REMOVE
var ajaxTimeout = null;

$(document)
	.ready(function() {
		fillYears();
		initCodeButtonGroups();
		initDateTimePickers();

		// Declares the Jquery Dialog ( The Bootstrap dialog does
		// not work in Google Earth )
		$("#dialogSuccess").dialog({
			modal : true,
			autoOpen : false,
			buttons : {
				Ok : function() {
					$(this).dialog("close");
				}
			}
		});
		// SAVING DATA WHEN USER SUBMITS
		$('#formAll').submit(
			function(e) {
				e.preventDefault();
				
				clearTimeout(ajaxTimeout); // So that the form
				// is not saved twice
				// if the user
				// clicks the submit
				// button before the
				// auto-save timeout
				// has started
				
				// Mark this as the "real submit" (as opposed
				// when saving data just because the user closes
				// the window) so we can show the placemark as
				// interpreted
				$("input[id=collect_boolean_actively_saved]")
					.val("true");
				
				submitForm($(this), 0);
			});
		
		//http://jqueryui.com/tooltip/
		$(document).tooltip({
			show : null,
			position : {
				my : "left top",
				at : "left bottom"
			},
			open : function(event, ui) {
				ui.tooltip.animate({
					top : ui.tooltip.position().top + 10
				}, "fast");
			}
		});
		
		checkIfPlacemarkAlreadyFilled('#formAll', 0);
});

var ajaxDataUpdate = function() {

	var activelySaved = $("input[id=collect_boolean_actively_saved]").val() == 'true';
	// Only update automatically when the data has not been correctly saved
	// before
	if (! activelySaved) {
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
				interpretJsonSaveResponse(json, activelySaved);
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
			interpretJsonSaveResponse(json, true);
		})
		.fail(function(jqXHR, textStatus, errorThrown) {
			if (submitCounter < 3) {
				submitForm($form, submitCounter + 1);
			} else {
				showErrorMessage("Cannot save the data, the Collect Earth server is not running!");
			}
		})
		.always(function() {
			$.unblockUI();
		});
}

var interpretJsonSaveResponse = function(json, activelySaved) {
	if (activelySaved) { //show feedback message
		if (json.success) {
			if (json.validData) {
				showSuccessMessage(json.message);
				forceWindowCloseAfterDialogCloses($("#dialogSuccess"));
			} else {
				var message = "";
				$.each(json.inputFieldInfoByParameterName, function(key, info) {
					if (info.inError) {
						var inputField = $("#" + key);
						var label = inputField.length > 0 ? OF.UI.Forms.getFieldLabel(inputField) : "";
						message += label + " : " + info.errorMessage + "<br>";
					}
				});
				showErrorMessage(message);
				
				// Resets the "actively saved" parameter to false so that it is not sent
				// as true when the user fixes the validation
				$("input[id=collect_boolean_actively_saved]").val('false');
			}
		} else {
			showErrorMessage(json.message);
		}
	}
	updateInputFieldsState(json.inputFieldInfoByParameterName);
};

var updateInputFieldsState = function(inputFieldInfoByParameterName) {
	//update possible values in SELECT elements
	$.each(inputFieldInfoByParameterName, function(fieldName, info) {
		var el = $("#" + fieldName);
		if (el.length == 1 && el.data("fieldType") == "code") {
			if (el.prop("tagName") == "SELECT") {
				var oldValue = el.val();
				var possibleItems = info.possibleCodedItems ? info.possibleCodedItems: [];
				OF.UI.Forms.populateSelect(el, possibleItems, "code", "label");
				el.val(oldValue);
				if (el.val() == null) {
					el.val("-1"); //set N/A option by default
				}
			} else {
				var parentCodeFieldId = el.data("parentCodeField");
				if (parentCodeFieldId) {
					var parentCodeInfo = inputFieldInfoByParameterName[parentCodeFieldId];
					var parentCodeValue = parentCodeInfo.value;
					var groupContainer = el.closest(".code-items-group");
					var itemsContainers = groupContainer.find(".code-items");
					itemsContainers.hide();
					
					var validItemsContainer = groupContainer.find(".code-items[data-parent-code='" + parentCodeValue + "']");
					validItemsContainer.show();
				}
			}
		}
	});
	//update errors feedback
	var errors = [];
	$.each(inputFieldInfoByParameterName, function(fieldName, info) {
		if (info.inError) {
			errors.push({field: fieldName, defaultMessage: info.errorMessage});
		}
	});
	OF.UI.Forms.Validation.updateErrors($("#formAll"), errors);
	
	//manage fields visibility
	$.each(inputFieldInfoByParameterName, function(fieldName, info) {
		var field = $("#" + fieldName);
		var formGroup = field.closest('.form-group');
		formGroup.toggle(info.visible);
	});
};

var serializeForm = function(formId) {
	return $("#" + formId).serialize();
};

var enableSelect = function(selectName, enable) { // #elementsCover
	if (enable == true) {
		$(selectName).prop('disabled', false);
	} else {
		$(selectName).prop('disabled', true);
	}
	// $(selectName).selectpicker('refresh');
};

var initCodeButtonGroups = function() {
	var form = $("#formAll");
	form.find("button.code-item").click(function() {
		var btn = $(this);
		var selected = btn.prop("selected");
		var itemsContainer = btn.closest(".code-items");
		var groupContainer = itemsContainer.closest(".code-items-group");
		itemsContainer.find(".item").prop("checked", false);
		btn.prop("checked", selected);
		var inputField = groupContainer.find("input[type='hidden']");
		inputField.val(btn.val());
		
		ajaxDataUpdate();
	});
};

var initDateTimePickers = function() {
	//http://eonasdan.github.io/bootstrap-datetimepicker/
	$('.datepicker').datetimepicker({
	   format: DATE_FORMAT
	})
	.on('dp.change', function(e) {
//		var inputField = $(this).find(".form-control");
//		inputField.change();
		ajaxDataUpdate();
	});
	
	$('.timepicker').datetimepicker({
	   format: TIME_FORMAT
	})
	.on('dp.change', function(e) {
		ajaxDataUpdate();
	});
};

var checkIfPlacemarkAlreadyFilled = function(formName, chechCount) {

	var data = $(formName + " :input[value]").serialize();
	
	$.ajax({
		data : data,
		type : "POST",
		//url : "$[host]placemarkInfo",
		 url: "http://127.0.0.1:8028/earth/placemark-info-expanded",
		dataType : 'json',
		timeout : 5000
	})
	.fail(
		function(jqXHR, textStatus, errorThrown) {
			if (chechCount < 3) {
				chechCount = chechCount + 1;
				checkIfPlacemarkAlreadyFilled(formName, chechCount);
			} else {
				showErrorMessage("The Collect Earth server is not running!");
				initializeChangeEventSaver();
			}
	})
	.done(
		function(json) {
			if (json.activelySaved
					&& json.inputFieldInfoByParameterName.collect_text_id != 'testPlacemark') { // 

				showErrorMessage("The data for this placemark has already been filled");

				//TODO
				if (json.earth_skip_filled
						&& json.earth_skip_filled == 'true') {
					forceWindowCloseAfterDialogCloses($("#dialogSuccess"));
				}
			}
			// Pre-fills the form and after that initilizes the
			// change event listeners for the inputs
			updateInputFieldsState(json.inputFieldInfoByParameterName);
			fillDataWithJson(json.inputFieldInfoByParameterName);
			initializeChangeEventSaver();
	});
};

var showSuccessMessage = function(message) {
	showMessage(message, "success");
};

var showWarningMessage = function(message) {
	showMessage(message, "warning");
};

var showErrorMessage = function(message) {
	showMessage(message, "error");
};

var showMessage = function(message, type) {
	var color;
	switch(type) {
	case "error":
		color = "red";
		break;
	case "warning":
		color = "yellow";
		break;
	case "success":
	default:
		color = "green";
	}
	$('#succ_mess')
		.css("color", color)
		.html(message ? message : "");
	$("#dialogSuccess").dialog("open");	
};

var fillDataWithJson = function(inputFieldInfoByParameterName) {
	$.each(inputFieldInfoByParameterName, function(key, info) {
		var value = info.value;
		// Do this for every key there might be different
		// tryopes of elements with the same key than a hidden
		// input
		
		if (key == "earth_skip_filled" && value == 'true') {
			$('#earth_skip_filled').attr('checked', value);
		} else {
			var values = value == null ? []: value.split(SEPARATOR_MULTIPLE_VALUES);// In
																					// case
																					// of
																					// value
																					// being
																					// 0;collect_code_deforestation_reason=burnt
			
			var inputField = $("*[name=\'" + key + "\']");
			if (inputField.length == 1) {
				var tagName = inputField.prop("tagName");
				switch(tagName) {
				case "INPUT":
					if (inputField.prop("type") == "checkbox") {
						inputField.prop("checked", value == "true");
					} else {
						inputField.val(values[0]);
					}
					break;
				case "TEXTAREA":
					inputField.val(value);
					break;
				case "SELECT":
					inputField.val(value);
					if (inputField.val() == null) {
						inputField.val("-1");
					}
					break;
				}
			} else if ($('#' + key + '_group').length == 1) { // button
															// group
															// exists
				for (var i = 0; i < values.length; i++) {
					// $('#'+key+'_group
					// .btn[value='+value+']').button('toggle'); //
					// set the class to "active" on the chosen
					// values
					var toggleButton = $('#' + key
							+ '_group .btn[value=\'' + value
							+ '\']');
					if (toggleButton.length == 1) {
						toggleButton.button('toggle');
//						if (key == "collect_code_land_use_category") {
//							activateLandUseDivs(toggleButton.val());
//						}
					}
				}
			}
		}
	});
}

var initializeChangeEventSaver = function() {
	$(".btn").click(function() {
		var groupId = $(this).closest("div .btn-group").attr("id");

		var suffixLength = "_group".length;
		if (groupId && groupId.length > suffixLength) {
			var value = $(this).val();
			// When we expect data sucha as
			// "0;collect_code_deforestation_reason=burnt"
			var values = value.split(SEPARATOR_MULTIPLE_VALUES);

			var idLength = groupId.length - suffixLength;
			var hiddenInputId = groupId.substring(0, idLength);
			$('#' + hiddenInputId).val(values[0]);// give the hidden input the
													// same value as the button
													// that just was clicked

			if ($('.' + hiddenInputId + '_dependant').length > 0) {
				var dependants = $('.' + hiddenInputId + '_dependant:hidden');
				resetDependants(hiddenInputId);
			}

			// If there is an extra value
			// "collect_code_deforestation_reason=burnt"
			if (values.length == 2) {
				var extraValues = values[1].split("=");
				$('#' + extraValues[0]).val(extraValues[1]);
			}
		}
		ajaxDataUpdate();
	});

	// SAVING DATA WHEN DATA CHANGES
	// Bind event to Before user leaves page with function parameter e
	// The window onbeforeunload or onunload events do not work in Google Earth
	// OBS! The change event is not fired for the hidden inputs when the value
	// is updated through jQuery's val()
	$('input[name^=collect], select[name^=collect],select[name^=hidden], button[name^=collect]')
		.change(function(e) {
			ajaxDataUpdate();
	});

	$('input:text[name^=collect], textarea[name^=collect]').keyup(function(e) {
		ajaxDataUpdate(1500);
	});
}

var fillYears = function() {
	for (var year = new Date().getFullYear(); year > 1980; year--) {
		$('.fillYears').each(function() {
			$(this).append(
				$("<option></option>")
					.attr("value", year)
						.text(year));
			});
	}
};

var forceWindowCloseAfterDialogCloses = function($dialog) {
	$dialog.on("dialogclose", function(event, ui) {
		window.open("#$[next_id];flyto"); // balloonFlyto - annoying to have
											// the balloon open, doesn't let you
											// see the plot
	});
};

