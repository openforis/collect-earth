var SEPARATOR_MULTIPLE_PARAMETERS = "===";
var SEPARATOR_MULTIPLE_VALUES = ";";
var DATE_FORMAT = 'MM/DD/YYYY';
var TIME_FORMAT = 'HH:ss';
var SUBMIT_LABEL = "Submit and validate";

var $form = null; //to be initialized 
var lastUpdateRequest = null; //last update request sent to the server

//To be used by the method that saves the data automatically when the user
//interacts with the form
//DO NOT REMOVE
var ajaxTimeout = null;

$(function() {
	$form = $("#formAll");
	$stepsContainer = $(".steps");
	
	initSteps();
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
	$form.submit(
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
	
	checkIfPlacemarkAlreadyFilled(0);
});

var ajaxDataUpdate = function(delay) {
	if (typeof delay == "undefined") {
		delay = 100;
	}
	
	abortLastUpdateRequest();

	var activelySaved = $("#collect_boolean_actively_saved").val() == 'true';

	// Only update automatically when the data has not been correctly saved
	// before
	var store = ! activelySaved;
	
	// Set a timeout so that the data is only sent to the server
	// if the user stops clicking for over one second

	ajaxTimeout = setTimeout(function() {
		var data = {placemarkId: getPlacemarkId(), values: serializeFormToJSON($form), store: store};

		lastUpdateRequest = $.ajax({
			data : data,
			type : "POST",
			url : $form.attr("action"),
			dataType : 'json'
		})
		.done(function(json) {
			interpretJsonSaveResponse(json, false);
		})
		.always(function() {
			lastUpdateRequest = null;
		});
	}, delay);
};

var abortLastUpdateRequest = function() {
	clearTimeout(ajaxTimeout);
	
	if (lastUpdateRequest != null) {
		lastUpdateRequest.abort();
		lastUpdateRequest = null;
	}
};
	
var submitForm = function(submitCounter) {
	abortLastUpdateRequest();
	
	var data = {placemarkId: getPlacemarkId(), values: serializeFormToJSON($form)};
	lastUpdateRequest = $
		.ajax({
			data : data,
			type : "POST",
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
				submitForm(submitCounter + 1);
			} else {
				showErrorMessage("Cannot save the data, the Collect Earth server is not running!");
			}
		})
		.always(function() {
			lastUpdateRequest = null;
			$.unblockUI();
		});
};

var interpretJsonSaveResponse = function(json, showUpdateMessage) {
	if (showUpdateMessage) { //show feedback message
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
	fillDataWithJson(json.inputFieldInfoByParameterName);
};

var updateInputFieldsState = function(inputFieldInfoByParameterName) {
	//update possible values in SELECT elements
	$.each(inputFieldInfoByParameterName, function(fieldName, info) {
		var el = $("#" + fieldName);
		if (el.length == 1) {
			switch(el.data("fieldType")) {
			case "CODE_SELECT":
				var oldValue = el.val();
				var possibleItems = info.possibleCodedItems ? info.possibleCodedItems: [];
				OF.UI.Forms.populateSelect(el, possibleItems, "code", "label");
				el.val(oldValue);
				if (el.val() == null) {
					el.val("-1"); //set N/A option by default
				}
				break;
			case "CODE_BUTTON_GROUP":
				var parentCodeFieldId = el.data("parentCodeFieldId");
				if (parentCodeFieldId) {
					var parentCodeInfo = inputFieldInfoByParameterName[parentCodeFieldId];
					var parentCodeValue = parentCodeInfo.value;
					var groupContainer = el.closest(".code-items-group");
					var itemsContainers = groupContainer.find(".code-items");
					itemsContainers.hide();
					
					var validItemsContainer = groupContainer.find(".code-items[data-parent-code='" + parentCodeValue + "']");
					validItemsContainer.show();
				}
				break;
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
	OF.UI.Forms.Validation.updateErrors($form, errors);
	
	updateStepsErrorFeedback();

	//manage fields visibility
	$.each(inputFieldInfoByParameterName, function(fieldName, info) {
		var field = $("#" + fieldName);
		var formGroup = field.closest('.form-group');
		formGroup.toggleClass("notrelevant", ! (info.visible));
	});
	
	//manage tabs/steps visibility
	$form.find(".step").each(function(index, value) {
		var stepBody = $(this);
		var hasNestedVisibleFormFields = stepBody.find(".form-group:not(.notrelevant)").length > 0;
		toggleStep(index, hasNestedVisibleFormFields);
	});
};

var toggleStep = function(index, visible) {
	var stepBody = $form.find(".step").eq(index);
	var stepHeading = $form.find(".steps .steps ul li").eq(index);
	if (visible) {
		if (stepHeading.hasClass("notrelevant")) {
			stepHeading.removeClass("notrelevant");
			if (stepHeading.hasClass("done")) {
				stepHeading.removeClass("disabled");
			}
		}
	} else {
		stepHeading.addClass("disabled notrelevant");
	}
	stepHeading.toggle(visible);
	
	if (! stepHeading.hasClass("current")) {
		stepBody.hide();
	}
};

var updateStepsErrorFeedback = function() {
	//update steps error feedback
	$form.find(".step").each(function(index, value) {
		var stepHeading = $form.find(".steps .steps ul li").eq(index);
		if (! stepHeading.hasClass("disabled")) {
			var hasErrors = $(this).find(".form-group.has-error").length > 0;
			stepHeading.toggleClass("error", hasErrors);
		}
	});
};

var initCodeButtonGroups = function() {
	$form.find("button.code-item").click(function() {
		//update hidden input field
		var btn = $(this);
		var itemsContainer = btn.closest(".code-items");
		var groupContainer = itemsContainer.closest(".code-items-group");
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

var initSteps = function() {
	$steps = $stepsContainer.steps({
		headerTag : "h3",
		bodyTag : "section",
		transitionEffect : "slideLeft",
		autoFocus : true,
		titleTemplate: /*"<span class=\"number\">#index#.</span>"*/ "#title#",
		labels: {
			finish: SUBMIT_LABEL
		},
		onStepChanged: function (event, currentIndex, priorIndex) {
			var stepHeading = $($form.find(".steps .steps ul li")[currentIndex]);
			if (stepHeading.hasClass("notrelevant")) {
				if (currentIndex > priorIndex) {
					$stepsContainer.steps("next");
				} else {
					$stepsContainer.steps("previous");
				}
			}
			updateStepsErrorFeedback();
		},
		onFinished: function (event, currentIndex) {
			$form.submit();
		}
		/*,
		onStepChanging : function(event, currentIndex, newIndex) {
			// Always allow previous action even if the current form is not
			// valid!
			if (newIndex < currentIndex) {
				return true;
			}
			if ($form.find(".step.current .form-group.has-error").length > 0) {
				// current form has some errors
				return false;
			}
			return true;
		}
		*/
	});
	$stepsContainer.find("a[href='#finish']").addClass("btn-finish");
};

var checkIfPlacemarkAlreadyFilled = function(checkCount) {

	var placemarkId = getPlacemarkId();
	
	$.ajax({
		data : {id: placemarkId},
		type : "GET",
		url: HOST + "placemark-info-expanded",
		dataType : 'json',
		timeout : 5000
	})
	.fail(
		function(jqXHR, textStatus, errorThrown) {
			if (checkCount < 3) {
				checkCount = checkCount + 1;
				checkIfPlacemarkAlreadyFilled(checkCount);
			} else {
				showErrorMessage("The Collect Earth server is not running!");
				initializeChangeEventSaver();
			}
	})
	.done(
		function(json) {
			if (json.activelySaved
					&& json.inputFieldInfoByParameterName.collect_text_id.value != 'testPlacemark') { // 

				showErrorMessage("The data for this placemark has already been filled");

				if (json.skipFilled) {
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

var getPlacemarkId = function() {
	var id = $form.find("input[name='collect_text_id']").val();
	return id;
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
		// type of elements with the same key than a hidden
		// input
		
//		var values = value == null ? []: value.split(SEPARATOR_MULTIPLE_VALUES);// In
																				// case
																				// of
																				// value
																				// being
																				// 0;collect_code_deforestation_reason=burnt
		var inputField = $("*[name=\'" + key + "\']");
		if (inputField.length == 1) {
			setValueInInputField(inputField, value);
		}
	});
}

var setValueInInputField = function(inputField, value) {
	var tagName = inputField.prop("tagName");
	switch(tagName) {
	case "INPUT":
		if (inputField.prop("type") == "checkbox") {
			inputField.prop("checked", value == "true");
		} else {
			if (inputField.val() != value) {
				inputField.val(value);
			}
		}
		if ("CODE_BUTTON_GROUP" == inputField.data("fieldType")) {
			var itemsGroup = inputField.closest(".code-items-group");
			//deselect all code item buttons
			itemsGroup.find(".code-item").removeClass('active');
			if (value != null && value != "") {
				//select code item button with value equals to the specified one
				var code = value;
				var activeCodeItemsContainer = itemsGroup.find(".code-items:visible");
				activeCodeItemsContainer.find(".code-item[value=" + code + "]").button('toggle');
			}
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
};

var initializeChangeEventSaver = function() {
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
		window.open("#" + NEXT_ID + ";flyto"); 	// balloonFlyto - annoying to have
												// the balloon open, doesn't let you
												// see the plot
	});
};

/**
 * Utility functions
 */
var serializeFormToJSON = function(form) {
   var o = {};
   var a = form.serializeArray();
   $.each(a, function() {
	   var key = encodeURIComponent(this.name);
	   var value = this.value || '';
       if (o[key]) {
           if (!o[key].push) {
               o[key] = [o[key]];
           }
           o[key].push(value);
       } else {
           o[key] = value;
       }
   });
   //include unchecked checkboxes
   form.find('input[type=checkbox]:not(:checked)').each(function() {
	   o[this.name] = this.checked;  
   });
   return o;
};

var serializeForm = function(formId) {
	var form = $("#" + formId);
	var result = form.serialize();
	form.find('input[type=checkbox]:not(:checked)').each(function() {
        result += "&" + this.name + "=" + this.checked;
	});
	return result;
};

var enableSelect = function(selectName, enable) { // #elementsCover
	$(selectName).prop('disabled', ! enable);
	// $(selectName).selectpicker('refresh');
};